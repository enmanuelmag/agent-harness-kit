# Sound asset provenance

Source pack: **Kenney Interface Sounds (1.0)**. Created/distributed by Kenney (www.kenney.nl), as recorded in the original license. License: **Creative Commons Zero (CC0)**; the supplied `License.txt` is preserved byte-for-byte as `LICENSE.txt`.

Local source: `/Users/sadie/Downloads/kenney_interface-sounds/Audio/`; license: `/Users/sadie/Downloads/kenney_interface-sounds/License.txt`. Originals remain unchanged.

Conversion tool: `ffmpeg version 9.0.2 Copyright (c) 2000-2026 the FFmpeg developers`.

Preparation command for each approved input:

```sh
ffmpeg -nostdin -v error -i ORIGINAL.ogg -c:a pcm_s16le -f wav ASSET.wav
```

Output: WAV PCM signed 16-bit little-endian, mono, 44,100 Hz. No filters, normalization, trimming, resampling or channel conversion were requested. Derived PCM bytes were verified equal to decoding each Ogg directly to PCM16 with the same tool. Vorbis header duration and decoded sample duration may differ; the original decoded samples are retained. For `back_003.ogg`, the Ogg header reports 0.092880 s; its retained native decode has 3,968 samples (0.089977 s in `health-blocked.wav`). No audio playback was performed.

| Event | Original | Packaged asset | Decoded samples | WAV duration (s) | WAV bytes | Future plays |
| --- | --- | --- | --- | --- | --- | --- |
| provider.completed | maximize_008.ogg | turn-completed.wav | 9938 | 0.225351 | 19954 | 1 |
| attention.requested | question_004.ogg | attention.wav | 14662 | 0.332472 | 29402 | 1 |
| task.completed | confirmation_002.ogg | task-completed.wav | 23770 | 0.539002 | 47618 | 1 |
| health.blocked | back_003.ogg | health-blocked.wav | 3968 | 0.089977 | 8014 | 2 |

**health.blocked uses one base asset.** Its future two sequential plays belong to one notification/eventId and one deduplication unit; this WAV is not concatenated or repeated. Playback, sequence gaps, hooks and runtime integration are not implemented by this preparation.

Total WAV bytes: **104988**.

## SHA-256

| File | SHA-256 |
| --- | --- |
| Original `maximize_008.ogg` | `57c074e600e193a303ce781c04c0ccc191c6030f9f106594fd94a65e55435c17` |
| Derived `turn-completed.wav` | `64b6625d7506a3a7886d09e50cb01f59b0f5ed9cab4085e99b43a2dc5a729e58` |
| Decoded PCM for `turn-completed.wav` | `33c52e92ff1ad84378bfbffaeebc4d0f97d11ada9fd03d7ecedace53b5f549f9` |
| Original `question_004.ogg` | `585ecb58b529dc49b5c5ce5ba93427bf73b7052bae55e49c43ba8f169c93ac99` |
| Derived `attention.wav` | `ccb957bd8d53f8c7c0aad556dacd27989cdc31af303771351c18ac14b4665511` |
| Decoded PCM for `attention.wav` | `942b82a88eb59df747a2c1f66459202474c3cce9cd730c9dd4869d7a4ade1231` |
| Original `confirmation_002.ogg` | `33b17a9a9a2397c62b285c52c33a907fdffb476909c99e42dde603f6a7a8b12c` |
| Derived `task-completed.wav` | `0a2e1eab0ef967c662b0e99856df99cd6d5303d825ac797b5c685c2c6cde5ba0` |
| Decoded PCM for `task-completed.wav` | `0a7e72f0808208ffe9d297aba7cfc6ee42369446d2baedd10bb65e47a553828e` |
| Original `back_003.ogg` | `ff5e87de1230b1a5f1fa83e5a4ba9d7eb1c07154267ac34b510a17d4caa03cef` |
| Derived `health-blocked.wav` | `4a72b2ade3f09eb169452626526d029ca4aec479e427035380f722bb87320762` |
| Decoded PCM for `health-blocked.wav` | `ceb51a0546b59fedb0be8825e9be8e77f1897228b888a4e86efcd78e112668c5` |
| Original and copied license | `f7966c773bbed0eca6a9c75081c44a178b38eae112724dbb5fdfbd4192d118a9` |
