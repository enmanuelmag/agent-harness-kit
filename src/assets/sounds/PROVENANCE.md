# Sound asset provenance

The packaged sound assets are prepared from two CC0 sources:

- **Kenney Interface Sounds (1.0)**, created/distributed by [Kenney](https://kenney.nl/). Its original `License.txt` is preserved byte-for-byte as `LICENSE.txt` for the three retained sounds. Source files remain in `/Users/sadie/Downloads/kenney_interface-sounds/Audio/` and are unmodified.
- **High Minimal On Notification 2_1** by Joao_Janz on [Freesound](https://freesound.org/people/Joao_Janz/sounds/504802/), licensed CC0. The full WAV download requires sign-in, so this preparation uses the site's public high-quality MP3 preview (`504802_9961300-hq.mp3`, 128 kbps, 48 kHz stereo). Preview SHA-256: `22910831c035f0dbc6e7a4ae5411684c76813a6912f2964fc0704ba944282812`.

## Preparation

The Kenney WAVs retain the earlier conversions documented by the source pack. `turn-completed.wav` is amplified by 1.2x and `attention.wav` by 1.25x; both are PCM 24-bit, mono, 44,100 Hz. These multipliers were applied to the existing assets without changing their duration or identity.

`health-blocked.wav` is a composed double pulse derived from the Freesound preview. The source is amplified by 16.9 dB to a measured peak of about -0.85 dBFS, converted to mono at 44,100 Hz, then arranged as follows: first pulse truncated at 0.36 s with a 0.04 s fade on its cut, a 0.05 s connecting gap, and the complete 0.979 s source as the second pulse with its natural fade preserved. The resulting WAV is PCM 24-bit and 1.389 s long. Playback sends this one composed file once per blocked event.

The task-completed asset remains unchanged: `confirmation_002.ogg` converted to PCM 16-bit, mono, 44,100 Hz. `health-blocked.wav` replaces the former `back_003.ogg` asset.

| Event | Source | Packaged asset | Processing |
| --- | --- | --- | --- |
| `task.completed` | Kenney `confirmation_002.ogg` | `task-completed.wav` | Existing PCM16 conversion |
| `provider.completed` | Kenney `maximize_008.ogg` | `turn-completed.wav` | Existing PCM16 conversion, then 1.2x gain and PCM24 output |
| `attention.requested` | Kenney `question_004.ogg` | `attention.wav` | Existing PCM16 conversion, then 1.25x gain and PCM24 output |
| `health.blocked` | Joao_Janz `504802_9961300-hq.mp3` preview | `health-blocked.wav` | 1.389 s double pulse, PCM24 output |

The health-blocked composition was played locally through macOS `afplay` for an audio check. The packaged filenames remain the same, so notification configuration does not need a new sound name.

## SHA-256

| File | SHA-256 |
| --- | --- |
| Original Kenney `maximize_008.ogg` | `57c074e600e193a303ce781c04c0ccc191c6030f9f106594fd94a65e55435c17` |
| Packaged `turn-completed.wav` | `34433466f39cc2660e457cf0ce89a6c4316bb8b36fa1625ebfdf5a9176189dac` |
| Original Kenney `question_004.ogg` | `585ecb58b529dc49b5c5ce5ba93427bf73b7052bae55e49c43ba8f169c93ac99` |
| Packaged `attention.wav` | `1f603dde3ae0b99a3ca138430543e6d55d0ceb1207ff5c135bc8b47a97717fc2` |
| Original Kenney `confirmation_002.ogg` | `33b17a9a9a2397c62b285c52c33a907fdffb476909c99e42dde603f6a7a8b12e` |
| Packaged `task-completed.wav` | `0a2e1eab0ef967c662b0e99856df99cd6d5303d825ac797b5c685c2c6cde5ba0` |
| Packaged `health-blocked.wav` | `c21a234c4f8f1466d1ead62dd704db003f3179aeb54d79659e48d6e17dac3d70` |
| Kenney license `LICENSE.txt` | `f7966c773bbed0eca6a9c75081c44a178b38eae112724dbb5fdfbd4192d118a9` |
