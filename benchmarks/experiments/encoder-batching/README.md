# Paired encoder comparison

Compare the previous scalar mask search and the current encoder in one native
process. Calls alternate order each round, with three warm-up rounds and nine
measured rounds per implementation. Output equality is checked outside timing.
The CSV reports medians; policy 0=fixed zero, 1=sampled, 2=exact; backend 0=UTF-16LE,
1=u16 units; integrity 0=none, 2=BLAKE3. Input construction and output drop are
excluded. CPU affinity, clocks and temperature are not controlled.

```sh
mkdir -p generated
git show v0.1.0:src/encoder.rs > generated/encoder-before.rs
rustc --edition=2021 -O -C lto=thin -C codegen-units=1 \
  benchmarks/experiments/encoder-batching/compare.rs -o generated/encoder-compare
./generated/encoder-compare > generated/encoder-comparison.csv
```

The scalar single-mask loop was retained: an alternative that separated full
words and the tail was approximately 15% slower in initial ARM64 screening.
Four independent carry chains performed better for sustained mask searches.
Low-entropy early exits keep their scalar priority probes. Sampled ranking stays
stable, and the public candidate count follows results considered in order.
