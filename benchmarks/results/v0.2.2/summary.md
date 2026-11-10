# Encoder comparison

Complete paired calls with BLAKE3. Unpinned hosts; lower milliseconds is faster. Native outputs are fresh buffers; browser output capacity is warm. See the adjacent environment and raw samples for each campaign.

| Runtime | Input | Policy | Before ms | After ms | Speedup |
| --- | --- | --- | ---: | ---: | ---: |
| browser | gzip-logs | exact | 20.0000 | 14.6000 | 1.37× |
| browser | gzip-logs | sampled | 8.1000 | 5.0000 | 1.62× |
| browser | random-1MiB | exact | 175.3000 | 125.5000 | 1.40× |
| browser | random-1MiB | sampled | 36.3000 | 15.9000 | 2.28× |
| native | random-1MiB | exact | 101.5398 | 98.0983 | 1.04× |
| native | random-1MiB | fixed0 | 3.0397 | 3.0089 | 1.01× |
| native-parallel | random-1MiB | exact | 98.3087 | 67.5389 | 1.46× |
