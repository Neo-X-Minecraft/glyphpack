# Encoder comparison

Complete paired calls with BLAKE3. Unpinned hosts; lower milliseconds is faster. Native outputs are fresh buffers; browser output capacity is warm. See the adjacent environment and raw samples for each campaign.

| Runtime | Input | Policy | Before ms | After ms | Speedup |
| --- | --- | --- | ---: | ---: | ---: |
| browser | gzip-logs | exact | 13.0000 | 9.4000 | 1.38× |
| browser | gzip-logs | sampled | 4.9000 | 3.1000 | 1.58× |
| browser | random-1MiB | exact | 113.0000 | 82.3000 | 1.37× |
| browser | random-1MiB | sampled | 18.4000 | 8.6000 | 2.14× |
