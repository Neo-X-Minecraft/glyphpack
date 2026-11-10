//! Optional native exact search. Scoped workers borrow the original slices;
//! only small score vectors cross thread boundaries. No input copies or pools.
use super::Input;

#[cfg(not(feature = "parallel-encoder"))]
pub(super) fn scores(_input: &Input<'_>, _masks: &[u8], _best: usize) -> Option<Vec<usize>> {
    None
}

#[cfg(feature = "parallel-encoder")]
pub(super) fn scores(input: &Input<'_>, masks: &[u8], best: usize) -> Option<Vec<usize>> {
    // Explicitly opt-in: exact search may discover the minimum late in its
    // priority sequence, so computing ahead can cost more on some patterns.
    // Keep small workloads serial and cap concurrency even on very large hosts.
    let workers = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(4);
    // A near-minimal incumbent often reaches the exact minimum soon; avoid
    // computing ahead on those low-loss inputs.
    if best.saturating_sub(input.len.div_ceil(4)) < input.len / 2048 {
        return None;
    }
    if workers < 2 || input.len.saturating_mul(masks.len()) < 64 * 1048576 {
        return None;
    }
    let group = masks.len().div_ceil(workers).div_ceil(4) * 4;
    Some(std::thread::scope(|scope| {
        let mut jobs = Vec::with_capacity(workers - 1);
        let mut groups = masks.chunks(group).peekable();
        let mut last = Vec::new();
        while let Some(masks) = groups.next() {
            if groups.peek().is_none() {
                last = score(input, masks);
            } else {
                // On platforms that cannot create another worker, compute that
                // group locally. The immutable references are Copy, so failure
                // never loses the input or requires an allocation-sized retry.
                let job = std::thread::Builder::new()
                    .name("glyphpack-encode".into())
                    .spawn_scoped(scope, move || score(input, masks));
                jobs.push(job.map_err(|_| score(input, masks)));
            }
        }
        let mut out = Vec::with_capacity(masks.len());
        for job in jobs {
            let scores = match job {
                Ok(handle) => match handle.join() {
                    Ok(value) => value,
                    Err(panic) => std::panic::resume_unwind(panic),
                },
                Err(value) => value,
            };
            out.extend(scores);
        }
        out.extend(last);
        out
    }))
}

#[cfg(feature = "parallel-encoder")]
fn score(input: &Input<'_>, masks: &[u8]) -> Vec<usize> {
    let mut out = Vec::with_capacity(masks.len());
    for chunk in masks.chunks(4) {
        if let Ok(group) = <[u8; 4]>::try_from(chunk) {
            out.extend(super::score_four(input, group));
        } else {
            out.extend(chunk.iter().map(|&m| super::count_pairs_in(input, m)));
        }
    }
    out
}
