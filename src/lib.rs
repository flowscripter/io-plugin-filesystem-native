//! Native local filesystem I/O exposed via Bun FFI.
//!
//! Each reader or writer handle owns one I/O thread feeding or draining a
//! bounded ring of buffers. The exported functions never block: they return
//! `WOULD_BLOCK` (2) and, once the handle is ready again, report its id
//! through the registered ready callback or the blocking `wait_any`.
//! Errors return -1 and are described by `last_error`.

pub mod fs;
pub mod ring;
pub mod waker;

use fs::OK;

unsafe fn path_from<'a>(ptr: *const u8, len: usize) -> Option<&'a str> {
    if ptr.is_null() {
        return None;
    }
    std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).ok()
}

unsafe fn write_slots(slots: [*mut usize; 3], values: [usize; 3]) {
    for (slot, value) in slots.into_iter().zip(values) {
        if !slot.is_null() {
            *slot = value;
        }
    }
}

/// # Safety
/// `path_ptr` must be valid for reads of `path_len` bytes.
#[no_mangle]
pub unsafe extern "C" fn reader_open(
    path_ptr: *const u8,
    path_len: usize,
    start: u64,
    end: u64,
    chunk_size: usize,
    depth: usize,
    fill_mode: u32,
) -> u32 {
    match path_from(path_ptr, path_len) {
        Some(path) => fs::reader_open(path, start, end, chunk_size, depth, fill_mode != 0),
        None => {
            fs::set_error("path is not valid UTF-8");
            0
        }
    }
}

/// # Safety
/// The out pointers must each be null or valid for a `usize` write.
#[no_mangle]
pub unsafe extern "C" fn reader_try_next(
    handle: u32,
    out_ptr: *mut usize,
    out_len: *mut usize,
    out_cap: *mut usize,
) -> i32 {
    match fs::reader_try_next(handle) {
        Ok(Some(raw)) => {
            write_slots(
                [out_ptr, out_len, out_cap],
                [raw.ptr, raw.len, raw.capacity],
            );
            OK
        }
        Ok(None) => fs::EOF,
        Err(code) => code,
    }
}

/// # Safety
/// `ptr` must stay valid for writes of `len` bytes until `reader_try_complete`
/// reports the fill finished.
#[no_mangle]
pub unsafe extern "C" fn reader_submit_into(handle: u32, ptr: *mut u8, len: usize) -> i32 {
    fs::reader_submit_into(handle, ptr as usize, len)
}

/// # Safety
/// `out_len` must be null or valid for a `usize` write.
#[no_mangle]
pub unsafe extern "C" fn reader_try_complete(handle: u32, out_len: *mut usize) -> i32 {
    match fs::reader_try_complete(handle) {
        Ok(Some(n)) => {
            if !out_len.is_null() {
                *out_len = n;
            }
            OK
        }
        Ok(None) => fs::EOF,
        Err(code) => code,
    }
}

#[no_mangle]
pub extern "C" fn reader_close(handle: u32) {
    fs::reader_close(handle);
}

/// # Safety
/// `ptr` and `capacity` must describe a buffer handed out by this library
/// that has not been freed.
#[no_mangle]
pub unsafe extern "C" fn buffer_free(ptr: *mut u8, capacity: usize) {
    fs::free_raw(ptr as usize, capacity);
}

/// Shaped like `JSTypedArrayBytesDeallocator`, with the capacity passed as
/// the context. Safe to call from a GC thread: it never calls into JS.
///
/// # Safety
/// As for [`buffer_free`].
#[no_mangle]
pub unsafe extern "C" fn buffer_gc_deallocator(bytes: *mut u8, capacity: usize) {
    fs::free_raw(bytes as usize, capacity);
}

/// # Safety
/// `path_ptr` must be valid for reads of `path_len` bytes.
#[no_mangle]
pub unsafe extern "C" fn writer_open(
    path_ptr: *const u8,
    path_len: usize,
    depth: usize,
    chunk_size: usize,
    append: u32,
) -> u32 {
    match path_from(path_ptr, path_len) {
        Some(path) => fs::writer_open(path, depth, chunk_size, append != 0),
        None => {
            fs::set_error("path is not valid UTF-8");
            0
        }
    }
}

/// # Safety
/// The out pointers must each be null or valid for a `usize` write.
#[no_mangle]
pub unsafe extern "C" fn writer_try_acquire(
    handle: u32,
    out_ptr: *mut usize,
    out_len: *mut usize,
) -> i32 {
    match fs::writer_try_acquire(handle) {
        Ok(raw) => {
            write_slots(
                [out_ptr, out_len, std::ptr::null_mut()],
                [raw.ptr, raw.len, 0],
            );
            OK
        }
        Err(code) => code,
    }
}

#[no_mangle]
pub extern "C" fn writer_commit(handle: u32, ptr: *mut u8, len: usize) -> i32 {
    fs::writer_commit(handle, ptr as usize, len)
}

#[no_mangle]
pub extern "C" fn writer_release(handle: u32, ptr: *mut u8) {
    fs::writer_release(handle, ptr as usize);
}

/// # Safety
/// `ptr` must be valid for reads of `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn writer_write(handle: u32, ptr: *const u8, len: usize) -> i32 {
    fs::writer_write(handle, ptr as usize, len)
}

#[no_mangle]
pub extern "C" fn writer_committed(handle: u32) -> u64 {
    fs::writer_committed(handle)
}

#[no_mangle]
pub extern "C" fn writer_close(handle: u32) -> i32 {
    fs::writer_close(handle)
}

#[no_mangle]
pub extern "C" fn writer_abort(handle: u32) {
    fs::writer_abort(handle);
}

#[no_mangle]
pub extern "C" fn writer_free(handle: u32) {
    fs::writer_free(handle);
}

#[no_mangle]
pub extern "C" fn set_ready_callback(function: usize) {
    waker::set_ready_callback(function);
}

#[no_mangle]
pub extern "C" fn wait_any() -> u32 {
    waker::wait_any()
}

#[no_mangle]
pub extern "C" fn waker_shutdown() {
    waker::shutdown();
}

/// Copies the last error message into `out` (at most `capacity` bytes) and
/// returns its full length.
///
/// # Safety
/// `out` must be valid for writes of `capacity` bytes.
#[no_mangle]
pub unsafe extern "C" fn last_error(out: *mut u8, capacity: usize) -> usize {
    let message = fs::last_error();
    let bytes = message.as_bytes();
    if !out.is_null() {
        let n = bytes.len().min(capacity);
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n);
    }
    bytes.len()
}
