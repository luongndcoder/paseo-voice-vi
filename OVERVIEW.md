# Vietnamese voice for Paseo

On-device Vietnamese-English dictation for the Paseo composer. It runs a
streaming sherpa-onnx Zipformer codeswitch model (nghiasr-vi-en-codeswitch,
~75 MB) on your machine, so microphone audio never leaves the laptop.

How it works: the plugin ships a worker entry (`bin/worker.mjs`) that speaks
the daemon local-speech worker protocol over IPC. When dictation is set to
`provider: "external"` with that command, the daemon forks the worker for
dictation sessions.

Setup: open the plugin screen, locate the vi-en codeswitch model (custom build, resolved from disk), run the worker self-test, then apply the dictation config and restart the daemon. The screen shows the worker path, model state,
current dictation settings, and any warnings.

Capabilities and limits: dictation STT only. Voice-mode STT, TTS, and turn
detection stay with the daemon built-in worker. The model download needs
network access the first time; everything else runs offline.
