use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};

static CALLBACK: AtomicUsize = AtomicUsize::new(0);
static READY: Mutex<VecDeque<u32>> = Mutex::new(VecDeque::new());
static READY_CV: Condvar = Condvar::new();

/// Registers the function called with a handle id whenever that handle
/// becomes ready. `0` unregisters it, which switches delivery to the
/// `wait_any` queue.
pub fn set_ready_callback(function: usize) {
    CALLBACK.store(function, Ordering::SeqCst);
}

/// Reports that `id` is ready, through the registered callback or, with none
/// registered, the `wait_any` queue.
pub fn notify(id: u32) {
    let function = CALLBACK.load(Ordering::SeqCst);
    if function != 0 {
        let callback: extern "C" fn(u32) = unsafe { std::mem::transmute(function) };
        callback(id);
        return;
    }
    READY.lock().unwrap().push_back(id);
    READY_CV.notify_one();
}

/// Blocks until a handle is ready and returns its id. Returns `0` after
/// [`shutdown`].
pub fn wait_any() -> u32 {
    let mut queue = READY.lock().unwrap();
    loop {
        if let Some(id) = queue.pop_front() {
            return id;
        }
        queue = READY_CV.wait(queue).unwrap();
    }
}

/// Wakes a blocked `wait_any` caller with the id `0`.
pub fn shutdown() {
    READY.lock().unwrap().push_back(0);
    READY_CV.notify_one();
}

#[cfg(test)]
pub fn reset() {
    CALLBACK.store(0, Ordering::SeqCst);
    READY.lock().unwrap().clear();
}

#[cfg(test)]
pub static TEST_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::thread;
    use std::time::Duration;

    static LAST: AtomicU32 = AtomicU32::new(0);

    extern "C" fn record(id: u32) {
        LAST.store(id, Ordering::SeqCst);
    }

    #[test]
    fn wait_any_receives_notifications_and_shutdown() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset();
        let waiter = thread::spawn(wait_any);
        thread::sleep(Duration::from_millis(20));
        notify(7);
        assert_eq!(waiter.join().unwrap(), 7);
        let waiter = thread::spawn(wait_any);
        thread::sleep(Duration::from_millis(20));
        shutdown();
        assert_eq!(waiter.join().unwrap(), 0);
        reset();
    }

    #[test]
    fn callback_replaces_the_queue() {
        let _guard = TEST_LOCK.lock().unwrap();
        reset();
        set_ready_callback(record as extern "C" fn(u32) as usize);
        notify(42);
        assert_eq!(LAST.load(Ordering::SeqCst), 42);
        assert!(READY.lock().unwrap().is_empty());
        reset();
    }
}
