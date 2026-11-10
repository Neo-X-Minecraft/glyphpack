# v0.2.0 results

`compact.csv` retains all 27 configurations and seven datasets. `summary.csv`
adds run ranges and sample counts. `environment.json` identifies the actual
browser, CPU context, selected candidates, source commit and implementation hashes.
`decode.svg` is a compact view of random 1 MiB with format checking on and compact
memory. Separate panels have separate scales.

`encoder-comparison.csv` is the alternating native old/new comparison; policies
0/1/2 mean fixed-zero/sampled/exact, integrity 0/2 means none/BLAKE3, and backends
0/1 mean UTF-16LE/u16 units. `encoder-browser.json` retains browser encoder samples.
The full raw browser CSV and native encoder samples are release assets so the
repository does not gain another large duplicated raw-data file.

See [performance and limitations](../../../docs/performance.md) and
[reproduction commands](../../../docs/benchmarking.md). Historical measurements
in the parent directory remain unchanged.
