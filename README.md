# paseo-voice-vi

Dictation (ASR/STT) Việt-Anh on-device cho Paseo: sherpa-onnx Zipformer
code-switch (`nghiasr-vi-en-codeswitch`, ~75 MB, bundle sẵn) hoặc NVIDIA Nemotron
3.5 streaming (tự tải, ~650 MB). Microphone → text ngay trên máy, nói chuyện với
daemon Paseo qua worker protocol có sẵn.

Plugin này **không phụ thuộc một fork Paseo cụ thể nào** — nó chạy với bất kỳ
daemon/fork nào implement đúng 2 thứ: `stt.provider: "external"` và local-speech
worker protocol (xem [Tương thích daemon](#tương-thích-daemon-fork-nào-cũng-được)).

## Kiến trúc

```
Paseo app (composer mic)
   │  dictation RPC
   ▼
Paseo daemon  ──fork IPC (local-speech worker protocol)──▶  paseo-voice-vi worker
  (provider "external")                                     sherpa-onnx + model
```

Daemon chỉ cần biết **provider `external` + đường dẫn worker**; toàn bộ ASR nằm
trong gói này. Worker fork mỗi khi dictate, buffer PCM16 theo segment, decode
offline ở `commit()` rồi trả final transcript.

## Yêu cầu

- Node.js ≥ 23.6 (worker chạy TypeScript trực tiếp bằng type stripping; khuyến nghị Node 24+).
- Daemon **có hỗ trợ `stt.provider: "external"`** (Paseo stock không có — xem bên dưới).
- Lần đầu dùng model chưa có: worker tự tải (codeswitch ~75 MB từ HuggingFace
  `NghiMe/NghiASR`, nemotron ~650 MB từ HuggingFace csukuangfj), cần mạng 1 lần.

## Tương thích: fork nào cũng được

Plugin + worker chỉ dựa trên hợp đồng công khai, không dựa code nội bộ của fork:

1. **Config file**: daemon chấp nhận
   ```json
   "features": {
     "dictation": {
       "enabled": true,
       "stt": {
         "provider": "external",
         "language": "vi",
         "external": { "command": "<plugin-checkout>/bin/worker.mjs" }
       }
     }
   }
   ```
2. **Worker protocol** (Node IPC, `serialization: "advanced"`):
   - Daemon → worker: `session.create` (`{ sessionId, kind: "dictationStt",
     config: { modelsDir, dictationLanguage? } }`), `session.append` (`{ sessionId,
     audio: ArrayBuffer PCM16LE }`), `session.commit` / `clear` / `flush` /
     `reset` / `close` (`{ sessionId }`), `stt.transcribe` (`{ audio, format }`).
   - Worker → daemon: `{ type: "response", requestId, ok, result?/error? }`,
     `{ type: "session.transcript", sessionId, payload: { segmentId, transcript,
     isFinal, language } }`, `{ type: "session.committed", ... }`,
     `{ type: "session.error", ... }`.
   - `session.create` trả về `{ requiredSampleRate }` (16000).
3. **Env truyền sang worker**: daemon fork worker với `env` kế thừa, nên worker
   đọc `PASEO_VOICE_VI_MODEL` (`codeswitch` | `nemotron`, mặc định codeswitch)
   và `PASEO_VOICE_VI_CODESWITCH_DIR` / `PASEO_VOICE_VI_MODEL_URL` (ghi đè chỗ
   resolve/tải model) trực tiếp từ môi trường daemon.

Bất kỳ fork nào implement 3 điểm trên đều chạy được plugin này nguyên vẹn.

## Cài plugin

Cài qua nút **Install plugin** trong Paseo với URL repo, hoặc CLI:

```bash
paseo plugin install /path/to/paseo-voice-vi   # hoặc github:luongndcoder/paseo-voice-vi
paseo plugin ls   # chờ paseo-voice-vi => running
```

Git install chạy `npm ci --omit=dev` (xem `build` trong `paseo-plugin.json`).
Worker **không cần devDependencies**: code worker chỉ dùng node builtins +
`sherpa-onnx-node`, cố ý tách khỏi `@getpaseo/plugin`/zod.

Sau đó mở màn **Vietnamese voice** (sidebar, hoặc ⌘K "Open Vietnamese voice setup"):

1. **Speech model** — bấm vào model để chọn (codeswitch/nemotron), thiếu file
   tự tải nền. Lựa chọn lưu vào `paseo-voice-vi.json` trong PASEO_HOME, có hiệu
   lực ở session dictate tiếp theo, **không cần restart daemon**. Env
   `PASEO_VOICE_VI_MODEL` trên daemon luôn thắng file (set là pin cứng).
2. **Microphone pipeline test** — fork worker thật, chạy đủ vòng protocol.
3. **Connect dictation** — ghi config external vào `config.json` (backup tự động),
   rồi **restart daemon**. Nút này từ chối chạy trên daemon không hỗ trợ external
   để không brick config.

Lưu ý hành vi:

- Chữ chỉ hiện khi **nhả mic** (model chạy offline theo từng đoạn, không có chữ live).
- Output viết **dạng câu bình thường** (model ra HOA do BPE, worker tự hạ về
  sentence-case; acronym như AI/OK bị hạ theo: `Ai`, `Ok`).

## Thiết lập daemon (fork)

Plugin cần 1 daemon hiểu `provider: "external"`. Các bước chung cho mọi máy:

```bash
# 1. Node 24+ (worker cần type stripping)
node --version   # >= 23.6

# 2. Chuẩn bị fork có external provider (ví dụ paseo-vietnamese-voice):
git clone <fork-repo> && cd <fork-repo>
npm ci

# 3. Build web UI để daemon tự serve (không build là mất giao diện web):
npm run build:daemon-web-ui   # nếu fork có script này

# 4. Chạy daemon từ source, giữ nguyên PASEO_HOME cũ (mang theo config/plugin/key):
#    WorkingDirectory: <fork>/packages/server
#    Command: node --import tsx scripts/dev-runner.ts
#    Env: PASEO_NODE_ENV=development, PASEO_HOME=<home cũ>,
#         PASEO_LISTEN=127.0.0.1:6767, PATH có node 24 đứng trước
```

Bẫy thường gặp khi đổi stock → fork:

- Giữ nguyên `PASEO_HOME` để mang theo config/plugin/identity.
- Xóa key lạ mà fork không hiểu (ví dụ stock 0.12 ghi `"runtime"` trong
  `plugins.*`) — fork báo `Unrecognized key` và từ chối boot.
- Backup `config.json` trước khi đổi gì.
- `paseo reload` không đủ cho đổi provider — **restart daemon**.
- Verify fork đã nhận external: log có
  `dictationStt: {provider: "external", explicit: true}` và không có `Invalid config`.

## Cài tay (không qua plugin)

```bash
git clone https://github.com/luongndcoder/paseo-voice-vi.git ~/paseo-voice-vi
cd ~/paseo-voice-vi
npm install   # full install (cần devDeps cho scripts/typecheck)

# 1. Kiểm tra sherpa-onnx + model + engine khởi tạo được:
node scripts/doctor.mjs
# (model bundle sẵn trong repo; thiếu thì tự tải theo PASEO_VOICE_VI_MODEL)

# 2. Test worker protocol không cần daemon:
node scripts/smoke-test.mjs

# 3. Trỏ daemon vào worker — thêm/sửa trong <PASEO_HOME>/config.json:
#   "features": {
#     "dictation": {
#       "enabled": true,
#       "stt": {
#         "provider": "external",
#         "language": "vi",
#         "external": { "command": "/Users/<you>/paseo-voice-vi/bin/worker.mjs" }
#       }
#     }
#   }

# 4. Restart daemon, mở Paseo và dictation như bình thường.
```

Gỡ: trả `provider` về `"local"` trong config và restart daemon.

## Scripts

| Script | Chức năng |
| --- | --- |
| `node scripts/download-model.mjs [modelsDir]` | Resolve/tải model đang chọn (mặc định `~/.paseo/models/local-speech`) |
| `node scripts/doctor.mjs [modelsDir]` | Kiểm tra sherpa-onnx + model + engine khởi tạo |
| `node scripts/smoke-test.mjs [modelsDir]` | Fork worker, test đủ vòng protocol (create→append→commit→close) |
| `bin/worker.mjs` | Entry point mà daemon fork |

Tất cả scripts tôn trọng `PASEO_VOICE_VI_MODEL=codeswitch|nemotron`.

## Ghi chú

- Worker chỉ phục vụ **dictation STT** (`session.create` kind `dictationStt`).
  Voice-mode STT/TTS/turn-detection vẫn do worker tích hợp sẵn của daemon đảm nhiệm.
-.Commit decode **đồng bộ**: final bắn ra trước khi `commit()` return, vì daemon
  có thể close session ngay sau đó — defer sang tick sau là mất final (spinner quay mãi).
- Đường dẫn worker trong config trỏ vào checkout cụ thể của plugin; mỗi lần update
  plugin là checkout mới → màn setup báo và bấm Connect lại 1 cái.
- Trên Linux cần `patchelf` nếu RUNPATH của addon sherpa bị hỏng (loader tự xử lý).
