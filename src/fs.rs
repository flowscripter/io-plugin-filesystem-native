use crate::ring::Ring;
use crate::waker::notify;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::thread::JoinHandle;

pub const EOF: i32 = 0;
pub const OK: i32 = 1;
pub const WOULD_BLOCK: i32 = 2;
pub const ERROR: i32 = -1;

static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());
static READERS: LazyLock<Mutex<HashMap<u32, Arc<Reader>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static WRITERS: LazyLock<Mutex<HashMap<u32, Arc<Writer>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn set_error(message: impl ToString) {
    *lock(&LAST_ERROR) = message.to_string();
}

pub fn last_error() -> String {
    lock(&LAST_ERROR).clone()
}

/// A leaked buffer's raw parts, handed to the JS side until `buffer_free`.
pub struct RawBuffer {
    pub ptr: usize,
    pub len: usize,
    pub capacity: usize,
}

fn into_raw(buffer: Vec<u8>) -> RawBuffer {
    let mut buffer = std::mem::ManuallyDrop::new(buffer);
    RawBuffer {
        ptr: buffer.as_mut_ptr() as usize,
        len: buffer.len(),
        capacity: buffer.capacity(),
    }
}

/// Releases a buffer previously handed out by this library.
///
/// # Safety
/// `ptr` and `capacity` must come from a [`RawBuffer`] that was not freed yet.
pub unsafe fn free_raw(ptr: usize, capacity: usize) {
    if ptr != 0 {
        drop(Vec::from_raw_parts(ptr as *mut u8, 0, capacity));
    }
}

fn read_full(file: &mut File, buffer: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

struct ReaderState {
    ring: Ring<Vec<u8>>,
    eof: bool,
    error: Option<String>,
    closed: bool,
    waiting: bool,
    fill_mode: bool,
    fill: Option<(usize, usize)>,
    fill_done: Option<Result<usize, String>>,
}

pub struct Reader {
    id: u32,
    state: Mutex<ReaderState>,
    wake: Condvar,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Reader {
    fn finish(self: &Arc<Self>, mut state: MutexGuard<'_, ReaderState>) {
        let waiting = std::mem::take(&mut state.waiting);
        drop(state);
        if waiting {
            notify(self.id);
        }
    }
}

fn reader_loop(reader: Arc<Reader>, mut file: File, mut remaining: u64, chunk_size: usize) {
    loop {
        let fill = {
            let mut state = lock(&reader.state);
            loop {
                if state.closed {
                    return;
                }
                let ready = if state.fill_mode {
                    state.fill.is_some()
                } else {
                    !state.ring.is_full()
                };
                if ready {
                    break;
                }
                state = reader.wake.wait(state).unwrap_or_else(|p| p.into_inner());
            }
            state.fill.take()
        };
        let limit = remaining.min(usize::MAX as u64) as usize;
        let (result, buffer) = match fill {
            Some((ptr, len)) => {
                let target =
                    unsafe { std::slice::from_raw_parts_mut(ptr as *mut u8, len.min(limit)) };
                (read_full(&mut file, target), None)
            }
            None => {
                let mut buffer = vec![0u8; chunk_size.min(limit)];
                let result = read_full(&mut file, &mut buffer);
                if let Ok(n) = result {
                    buffer.truncate(n);
                }
                (result, Some(buffer))
            }
        };
        let mut state = lock(&reader.state);
        let mut finished = false;
        match result {
            Ok(n) => {
                remaining -= n as u64;
                if n == 0 || remaining == 0 {
                    state.eof = true;
                    finished = true;
                }
                match buffer {
                    Some(buffer) => {
                        if n > 0 {
                            let _ = state.ring.try_push(buffer);
                        }
                    }
                    None => state.fill_done = Some(Ok(n)),
                }
            }
            Err(error) => {
                state.eof = true;
                finished = true;
                match buffer {
                    Some(_) => state.error = Some(error.to_string()),
                    None => state.fill_done = Some(Err(error.to_string())),
                }
            }
        }
        reader.finish(state);
        if finished {
            return;
        }
    }
}

/// Opens `path` for reading bytes `start..end` (`end` of `u64::MAX` reads to
/// the end of the file) on a dedicated thread. A reader in `fill_mode` reads
/// only into buffers passed to `reader_submit_into`, never ahead on its own. Returns the handle id, or `0`
/// with the error recorded.
pub fn reader_open(
    path: &str,
    start: u64,
    end: u64,
    chunk_size: usize,
    depth: usize,
    fill_mode: bool,
) -> u32 {
    let opened = File::open(path).and_then(|mut file| {
        file.seek(SeekFrom::Start(start))?;
        Ok(file)
    });
    let file = match opened {
        Ok(file) => file,
        Err(error) => {
            set_error(format!("{path}: {error}"));
            return 0;
        }
    };
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let reader = Arc::new(Reader {
        id,
        state: Mutex::new(ReaderState {
            ring: Ring::new(depth),
            eof: false,
            error: None,
            closed: false,
            waiting: false,
            fill_mode,
            fill: None,
            fill_done: None,
        }),
        wake: Condvar::new(),
        thread: Mutex::new(None),
    });
    let remaining = end.saturating_sub(start);
    let for_thread = Arc::clone(&reader);
    let handle = std::thread::spawn(move || {
        reader_loop(for_thread, file, remaining, chunk_size.max(1));
    });
    *lock(&reader.thread) = Some(handle);
    lock(&READERS).insert(id, reader);
    id
}

fn reader(id: u32) -> Option<Arc<Reader>> {
    lock(&READERS).get(&id).cloned()
}

/// Takes the next buffered chunk, or reports end of file, an error, or that
/// the caller must wait for the ready notification.
pub fn reader_try_next(id: u32) -> Result<Option<RawBuffer>, i32> {
    let Some(reader) = reader(id) else {
        set_error("unknown reader handle");
        return Err(ERROR);
    };
    let mut state = lock(&reader.state);
    if let Some(buffer) = state.ring.try_pop() {
        drop(state);
        reader.wake.notify_one();
        return Ok(Some(into_raw(buffer)));
    }
    if let Some(message) = state.error.clone() {
        set_error(message);
        return Err(ERROR);
    }
    if state.eof || state.closed {
        return Ok(None);
    }
    state.waiting = true;
    Err(WOULD_BLOCK)
}

/// Asks the reader thread to read directly into `ptr..ptr+len`. The memory
/// must stay valid until the completion is collected.
pub fn reader_submit_into(id: u32, ptr: usize, len: usize) -> i32 {
    let Some(reader) = reader(id) else {
        set_error("unknown reader handle");
        return ERROR;
    };
    let mut state = lock(&reader.state);
    if state.fill.is_some() || (state.fill_done.is_some() && !state.eof) {
        set_error("a fill request is already outstanding");
        return ERROR;
    }
    state.fill_mode = true;
    if state.eof && state.fill_done.is_none() {
        state.fill_done = Some(Ok(0));
    } else if !state.eof {
        state.fill = Some((ptr, len));
    }
    drop(state);
    reader.wake.notify_one();
    OK
}

/// Collects the outcome of the last submitted fill.
pub fn reader_try_complete(id: u32) -> Result<Option<usize>, i32> {
    let Some(reader) = reader(id) else {
        set_error("unknown reader handle");
        return Err(ERROR);
    };
    let mut state = lock(&reader.state);
    match state.fill_done.take() {
        Some(Ok(0)) => {
            state.fill_done = Some(Ok(0));
            Ok(None)
        }
        Some(Ok(n)) => Ok(Some(n)),
        Some(Err(message)) => {
            state.fill_done = Some(Err(message.clone()));
            set_error(message);
            Err(ERROR)
        }
        None => {
            state.waiting = true;
            Err(WOULD_BLOCK)
        }
    }
}

/// Stops the reader thread, waits for it and releases the handle.
pub fn reader_close(id: u32) {
    let Some(reader) = lock(&READERS).remove(&id) else {
        return;
    };
    lock(&reader.state).closed = true;
    reader.wake.notify_all();
    let handle = lock(&reader.thread).take();
    if let Some(handle) = handle {
        let _ = handle.join();
    }
}

struct WriterState {
    free: Vec<Vec<u8>>,
    allocated: usize,
    leased: HashMap<usize, Vec<u8>>,
    queue: Ring<(Vec<u8>, usize, bool)>,
    closing: bool,
    aborted: bool,
    done: bool,
    error: Option<String>,
    waiting: bool,
}

pub struct Writer {
    id: u32,
    state: Mutex<WriterState>,
    wake: Condvar,
    committed: AtomicU64,
    depth: usize,
    chunk_size: usize,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Writer {
    fn finish(&self, mut state: MutexGuard<'_, WriterState>) {
        let waiting = std::mem::take(&mut state.waiting);
        drop(state);
        if waiting {
            notify(self.id);
        }
    }
}

fn writer_loop(writer: Arc<Writer>, mut file: File) {
    loop {
        let (mut buffer, len, pooled) = {
            let mut state = lock(&writer.state);
            loop {
                if state.aborted {
                    state.done = true;
                    writer.finish(state);
                    return;
                }
                if let Some(item) = state.queue.try_pop() {
                    break item;
                }
                if state.closing {
                    state.done = true;
                    writer.finish(state);
                    return;
                }
                state = writer.wake.wait(state).unwrap_or_else(|p| p.into_inner());
            }
        };
        let result = file.write_all(&buffer[..len]);
        let mut state = lock(&writer.state);
        match result {
            Ok(()) => {
                writer.committed.fetch_add(len as u64, Ordering::SeqCst);
                if pooled {
                    unsafe { buffer.set_len(buffer.capacity()) };
                    state.free.push(buffer);
                }
            }
            Err(error) => {
                state.error = Some(error.to_string());
                state.done = true;
                writer.finish(state);
                return;
            }
        }
        writer.finish(state);
    }
}

/// Opens `path` for writing (appending when `append` is set) on a dedicated
/// thread. `depth` bounds both the queued writes and the lease buffers of
/// `chunk_size` bytes. Returns the handle id, or `0` with the error recorded.
pub fn writer_open(path: &str, depth: usize, chunk_size: usize, append: bool) -> u32 {
    let mut options = OpenOptions::new();
    options.create(true);
    if append {
        options.append(true);
    } else {
        options.write(true).truncate(true);
    }
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) => {
            set_error(format!("{path}: {error}"));
            return 0;
        }
    };
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let writer = Arc::new(Writer {
        id,
        state: Mutex::new(WriterState {
            free: Vec::new(),
            allocated: 0,
            leased: HashMap::new(),
            queue: Ring::new(depth),
            closing: false,
            aborted: false,
            done: false,
            error: None,
            waiting: false,
        }),
        wake: Condvar::new(),
        committed: AtomicU64::new(0),
        depth: depth.max(1),
        chunk_size: chunk_size.max(1),
        thread: Mutex::new(None),
    });
    let for_thread = Arc::clone(&writer);
    let handle = std::thread::spawn(move || writer_loop(for_thread, file));
    *lock(&writer.thread) = Some(handle);
    lock(&WRITERS).insert(id, writer);
    id
}

fn writer(id: u32) -> Option<Arc<Writer>> {
    lock(&WRITERS).get(&id).cloned()
}

fn failed(state: &WriterState) -> Option<i32> {
    state.error.as_ref().map(|message| {
        set_error(message);
        ERROR
    })
}

/// Leases a writable buffer from the pool, or reports that the caller must
/// wait for one to be recycled.
pub fn writer_try_acquire(id: u32) -> Result<RawBuffer, i32> {
    let Some(writer) = writer(id) else {
        set_error("unknown writer handle");
        return Err(ERROR);
    };
    let mut state = lock(&writer.state);
    if let Some(code) = failed(&state) {
        return Err(code);
    }
    let buffer = match state.free.pop() {
        Some(buffer) => buffer,
        None if state.allocated < writer.depth => {
            state.allocated += 1;
            vec![0u8; writer.chunk_size]
        }
        None => {
            state.waiting = true;
            return Err(WOULD_BLOCK);
        }
    };
    let raw = RawBuffer {
        ptr: buffer.as_ptr() as usize,
        len: buffer.len(),
        capacity: buffer.capacity(),
    };
    state.leased.insert(raw.ptr, buffer);
    Ok(raw)
}

/// Queues the first `len` bytes of a leased buffer for writing.
pub fn writer_commit(id: u32, ptr: usize, len: usize) -> i32 {
    let Some(writer) = writer(id) else {
        set_error("unknown writer handle");
        return ERROR;
    };
    let mut state = lock(&writer.state);
    if let Some(code) = failed(&state) {
        return code;
    }
    let Some(buffer) = state.leased.remove(&ptr) else {
        set_error("buffer is not leased");
        return ERROR;
    };
    let len = len.min(buffer.len());
    let _ = state.queue.try_push((buffer, len, true));
    drop(state);
    writer.wake.notify_one();
    OK
}

/// Returns a leased buffer to the pool without writing it.
pub fn writer_release(id: u32, ptr: usize) -> i32 {
    let Some(writer) = writer(id) else {
        return ERROR;
    };
    let mut state = lock(&writer.state);
    if let Some(buffer) = state.leased.remove(&ptr) {
        state.free.push(buffer);
    }
    writer.finish(state);
    OK
}

/// Copies `ptr..ptr+len` into the write queue. The source memory may be
/// released as soon as this returns `OK`.
pub fn writer_write(id: u32, ptr: usize, len: usize) -> i32 {
    let Some(writer) = writer(id) else {
        set_error("unknown writer handle");
        return ERROR;
    };
    let mut state = lock(&writer.state);
    if let Some(code) = failed(&state) {
        return code;
    }
    if state.closing || state.aborted {
        set_error("writer is closed");
        return ERROR;
    }
    if state.queue.is_full() {
        state.waiting = true;
        return WOULD_BLOCK;
    }
    let data = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) }.to_vec();
    let _ = state.queue.try_push((data, len, false));
    drop(state);
    writer.wake.notify_one();
    OK
}

/// Bytes the writer thread has written to the file so far.
pub fn writer_committed(id: u32) -> u64 {
    writer(id).map_or(0, |writer| writer.committed.load(Ordering::SeqCst))
}

fn join_writer(writer: &Arc<Writer>) {
    let handle = lock(&writer.thread).take();
    if let Some(handle) = handle {
        let _ = handle.join();
    }
}

/// Flushes the queued writes. `WOULD_BLOCK` means the flush is still
/// running: wait for the ready notification and call again. The handle stays
/// valid for `writer_committed` until `writer_free`.
pub fn writer_close(id: u32) -> i32 {
    let Some(writer) = writer(id) else {
        return OK;
    };
    let mut state = lock(&writer.state);
    state.closing = true;
    if !state.done {
        state.waiting = true;
        drop(state);
        writer.wake.notify_one();
        return WOULD_BLOCK;
    }
    let code = failed(&state).unwrap_or(OK);
    drop(state);
    join_writer(&writer);
    code
}

/// Discards the queued writes and stops the writer thread.
pub fn writer_abort(id: u32) {
    let Some(writer) = writer(id) else {
        return;
    };
    lock(&writer.state).aborted = true;
    writer.wake.notify_all();
    join_writer(&writer);
}

/// Releases the handle, aborting the writer first if it is still running.
pub fn writer_free(id: u32) {
    writer_abort(id);
    lock(&WRITERS).remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::waker::{reset, set_ready_callback, wait_any, TEST_LOCK};
    use std::sync::atomic::AtomicUsize;
    use std::time::Duration;

    fn temp_path(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("fsnative-{}-{name}", std::process::id()));
        dir.to_string_lossy().into_owned()
    }

    fn sample(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    fn drain(id: u32) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            match reader_try_next(id) {
                Ok(Some(raw)) => {
                    out.extend_from_slice(unsafe {
                        std::slice::from_raw_parts(raw.ptr as *const u8, raw.len)
                    });
                    unsafe { free_raw(raw.ptr, raw.capacity) };
                }
                Ok(None) => return out,
                Err(WOULD_BLOCK) => {
                    wait_any();
                }
                Err(_) => panic!("reader error: {}", last_error()),
            }
        }
    }

    #[test]
    fn reads_a_whole_file_in_chunks() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("whole");
        let data = sample(100_000);
        std::fs::write(&path, &data).unwrap();
        let id = reader_open(&path, 0, u64::MAX, 4096, 2, false);
        assert_ne!(id, 0);
        assert_eq!(drain(id), data);
        reader_close(id);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn reads_a_range_and_clamps_to_the_end() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("range");
        let data = sample(10_000);
        std::fs::write(&path, &data).unwrap();
        let id = reader_open(&path, 1_000, 3_500, 1024, 2, false);
        assert_eq!(drain(id), data[1_000..3_500]);
        reader_close(id);
        let id = reader_open(&path, 9_000, u64::MAX, 1024, 2, false);
        assert_eq!(drain(id), data[9_000..]);
        reader_close(id);
        let id = reader_open(&path, 20_000, u64::MAX, 1024, 2, false);
        assert!(drain(id).is_empty());
        reader_close(id);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn open_errors_are_reported() {
        assert_eq!(
            reader_open("/nonexistent/fsnative", 0, u64::MAX, 16, 2, false),
            0
        );
        assert!(last_error().contains("/nonexistent/fsnative"));
        assert_eq!(writer_open("/nonexistent/dir/file", 2, 16, false), 0);
    }

    #[test]
    fn empty_file_is_end_of_file() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("empty");
        std::fs::write(&path, b"").unwrap();
        let id = reader_open(&path, 0, u64::MAX, 16, 2, false);
        assert!(drain(id).is_empty());
        reader_close(id);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn fills_caller_supplied_buffers() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("fill");
        let data = sample(2_500);
        std::fs::write(&path, &data).unwrap();
        let id = reader_open(&path, 0, u64::MAX, 1024, 2, true);
        let mut out = Vec::new();
        loop {
            let mut buffer = vec![0u8; 1000];
            assert_eq!(
                reader_submit_into(id, buffer.as_mut_ptr() as usize, buffer.len()),
                OK
            );
            let filled = loop {
                match reader_try_complete(id) {
                    Ok(filled) => break filled,
                    Err(WOULD_BLOCK) => {
                        wait_any();
                    }
                    Err(_) => panic!("fill error"),
                }
            };
            match filled {
                Some(n) => out.extend_from_slice(&buffer[..n]),
                None => break,
            }
        }
        assert_eq!(out, data);
        reader_close(id);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn writer_round_trip_with_leases_and_pushes() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("write");
        let id = writer_open(&path, 2, 8, false);
        assert_ne!(id, 0);
        let lease = writer_try_acquire(id).unwrap();
        assert_eq!(lease.len, 8);
        unsafe { std::slice::from_raw_parts_mut(lease.ptr as *mut u8, 8) }
            .copy_from_slice(b"leasedAB");
        assert_eq!(writer_commit(id, lease.ptr, 6), OK);
        let spare = writer_try_acquire(id).unwrap();
        assert_eq!(writer_release(id, spare.ptr), OK);
        let pushed = b"-pushed";
        assert_eq!(writer_write(id, pushed.as_ptr() as usize, pushed.len()), OK);
        loop {
            match writer_close(id) {
                OK => break,
                WOULD_BLOCK => {
                    wait_any();
                }
                other => panic!("close failed: {other}"),
            }
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"leased-pushed");
        assert_eq!(writer_committed(id), 13);
        writer_free(id);
        assert_eq!(writer_committed(id), 0);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn writer_appends_and_counts_committed_bytes() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("append");
        std::fs::write(&path, b"head-").unwrap();
        let id = writer_open(&path, 2, 8, true);
        assert_eq!(writer_write(id, b"tail".as_ptr() as usize, 4), OK);
        while writer_committed(id) < 4 {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(writer_committed(id), 4);
        while writer_close(id) == WOULD_BLOCK {
            wait_any();
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"head-tail");
        writer_free(id);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn exhausted_lease_pool_blocks_until_a_buffer_is_recycled() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("pool");
        let id = writer_open(&path, 1, 4, false);
        let lease = writer_try_acquire(id).unwrap();
        assert_eq!(writer_try_acquire(id).err(), Some(WOULD_BLOCK));
        assert_eq!(writer_commit(id, lease.ptr, 4), OK);
        assert_eq!(wait_any(), id);
        assert!(writer_try_acquire(id).is_ok());
        writer_free(id);
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn abort_discards_and_unknown_handles_are_rejected() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("abort");
        let id = writer_open(&path, 2, 8, false);
        writer_abort(id);
        assert_eq!(writer_write(id, b"x".as_ptr() as usize, 1), ERROR);
        assert_eq!(writer_commit(id, 1, 1), ERROR);
        assert_eq!(writer_close(id), OK);
        writer_free(id);
        assert_eq!(writer_write(id, b"x".as_ptr() as usize, 1), ERROR);
        assert!(reader_try_next(9_999_999).is_err());
        std::fs::remove_file(&path).unwrap();
    }

    static CALLS: AtomicUsize = AtomicUsize::new(0);

    extern "C" fn count(_id: u32) {
        CALLS.fetch_add(1, Ordering::SeqCst);
    }

    #[test]
    fn ready_callback_fires_only_when_a_waiter_is_registered() {
        let _guard = lock(&TEST_LOCK);
        reset();
        let path = temp_path("callback");
        let data = sample(64);
        std::fs::write(&path, &data).unwrap();
        CALLS.store(0, Ordering::SeqCst);
        set_ready_callback(count as extern "C" fn(u32) as usize);
        let id = reader_open(&path, 0, u64::MAX, 16, 8, false);
        while lock(&READERS)
            .get(&id)
            .map_or(0, |r| lock(&r.state).ring.len())
            < 4
        {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(CALLS.load(Ordering::SeqCst), 0);
        let mut seen = 0;
        loop {
            match reader_try_next(id) {
                Ok(Some(raw)) => {
                    seen += raw.len;
                    unsafe { free_raw(raw.ptr, raw.capacity) };
                }
                Ok(None) => break,
                Err(_) => std::thread::sleep(Duration::from_millis(5)),
            }
        }
        assert_eq!(seen, 64);
        assert_eq!(CALLS.load(Ordering::SeqCst), 0);
        reader_close(id);
        let empty = temp_path("callback-empty");
        std::fs::write(&empty, b"").unwrap();
        let id = reader_open(&empty, 0, u64::MAX, 16, 2, false);
        loop {
            match reader_try_next(id) {
                Err(WOULD_BLOCK) => std::thread::sleep(Duration::from_millis(5)),
                _ => break,
            }
        }
        reader_close(id);
        reset();
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_file(&empty).unwrap();
    }
}
