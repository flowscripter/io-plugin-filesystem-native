use std::collections::VecDeque;

/// A fixed-capacity FIFO of values. It holds no locking of its own: callers
/// wrap it in the mutex that also guards the state around it.
pub struct Ring<T> {
    items: VecDeque<T>,
    capacity: usize,
}

impl<T> Ring<T> {
    pub fn new(capacity: usize) -> Self {
        Ring {
            items: VecDeque::with_capacity(capacity),
            capacity: capacity.max(1),
        }
    }

    /// Appends a value, handing it back if the ring is full.
    pub fn try_push(&mut self, value: T) -> Result<(), T> {
        if self.is_full() {
            return Err(value);
        }
        self.items.push_back(value);
        Ok(())
    }

    pub fn try_pop(&mut self) -> Option<T> {
        self.items.pop_front()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn is_full(&self) -> bool {
        self.items.len() >= self.capacity
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Condvar, Mutex};
    use std::thread;

    #[test]
    fn rejects_push_when_full_and_keeps_order() {
        let mut ring = Ring::new(2);
        assert!(ring.try_push(1).is_ok());
        assert!(ring.try_push(2).is_ok());
        assert!(ring.is_full());
        assert_eq!(ring.try_push(3), Err(3));
        assert_eq!(ring.try_pop(), Some(1));
        assert_eq!(ring.len(), 1);
        assert!(ring.try_push(3).is_ok());
        assert_eq!(ring.try_pop(), Some(2));
        assert_eq!(ring.try_pop(), Some(3));
        assert!(ring.is_empty());
        assert_eq!(ring.try_pop(), None);
        assert_eq!(ring.capacity(), 2);
    }

    #[test]
    fn capacity_is_at_least_one() {
        assert_eq!(Ring::<u8>::new(0).capacity(), 1);
    }

    #[test]
    fn producer_consumer_stress_preserves_every_value_in_order() {
        const COUNT: u64 = 50_000;
        let shared = Arc::new((Mutex::new(Ring::new(3)), Condvar::new()));
        let producer_shared = Arc::clone(&shared);
        let producer = thread::spawn(move || {
            let (lock, cv) = &*producer_shared;
            for value in 0..COUNT {
                let mut ring = lock.lock().unwrap();
                while ring.is_full() {
                    ring = cv.wait(ring).unwrap();
                }
                ring.try_push(value).unwrap();
                cv.notify_all();
            }
        });
        let (lock, cv) = &*shared;
        let mut expected = 0;
        while expected < COUNT {
            let mut ring = lock.lock().unwrap();
            while ring.is_empty() {
                ring = cv.wait(ring).unwrap();
            }
            assert_eq!(ring.try_pop(), Some(expected));
            expected += 1;
            cv.notify_all();
        }
        producer.join().unwrap();
    }
}
