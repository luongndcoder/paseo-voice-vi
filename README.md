# paseo-voice-vi

Dictation (ASR/STT) Việt-Anh cho Paseo — chạy on-device bằng sherpa-onnx
Zipformer code-switch (`nghiasr-vi-en-codeswitch`, ~75 MB), microphone → text
ngay trên máy, nói chuyện với daemon Paseo qua worker protocol có sẵn.

## Kiến trúc

```
Paseo app (composer mic)
   │  dictation RPC
   ▼
Paseo daemon  ──fork IPC (local-speech worker protocol)──▶  paseo-voice-vi worker
  (provider "external")                                     sherpa-onnx + model vi-en
```

Daemon chỉ cần biết **provider `external` + đường dẫn worker**; model vi-en (~74 MB)
được bundle sẵn trong repo (`models/`), cài plugin là có luôn. Nếu thiếu, worker
tự tải từ HuggingFace `NghiMe/NghiASR` ở lần dùng đầu.

## Yêu cầu

- Node.js ≥ 23.6 (chạy TypeScript trực tiếp bằng type stripping; khuyến nghị Node 24+).
- Paseo daemon bản fork có hỗ trợ `stt.provider: "external"` (Paseo stock không có —
  xem [Thiết lập daemon](#thiết-lập-daemon-fork) bên dưới).

## Thiết lập daemon (fork)

Plugin chỉ là một nửa — nửa còn lại là daemon fork (`paseo-vietnamese-voice`),
bản duy nhất hiểu `provider: "external"`. Các bước đã verify trên cả macOS và Linux:

```bash
# 1. Node 24+ (worker cần type stripping, stock node cũ không chạy được)
node --version   # >= 23.6, khuyến nghị v24 LTS

# 2. Clone fork + cài deps
git clone https://github.com/luongndcoder/paseo.git paseo-vietnamese-voice
cd paseo-vietnamese-voice
npm ci

# 3. Build web UI để daemon tự serve (không build là mất giao diện web)
npm run build:daemon-web-ui

# 4. Chạy daemon từ source (dev mode, không cần build server):
#    WorkingDirectory: <repo>/packages/server
#    Command: node --import tsx scripts/dev-runner.ts
#    Env: PASEO_NODE_ENV=development, PASEO_HOME=<home hiện tại>,
#         PASEO_LISTEN=127.0.0.1:6767, PATH có node 24 đứng trước
```

Lưu ý khi chuyển từ stock sang fork:

- Giữ nguyên `PASEO_HOME` để mang theo config, plugin, key, pairing cũ.
- Xóa key `"runtime"` trong các entry `plugins.*` của `config.json` nếu daemon
  báo `Unrecognized key: "runtime"` (field này stock mới có, fork chưa biết).
- Backup `config.json` trước khi đổi gì (fork và stock parse schema khác nhau).
- Bật dictation external: màn plugin **Vietnamese voice → Connect dictation**,
  hoặc ghi tay vào `config.json` rồi **restart daemon** (reload không đủ):

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

Verify fork đã nhận: log daemon có
`requestedProviders.dictationStt: {provider: "external", explicit: true}`
và không có lỗi `Invalid config`. Sau đó self-test trong màn plugin phải pass —
lưu ý đường dẫn worker là checkout dir của plugin (đổi mỗi lần update plugin,
màn setup sẽ báo và bấm Connect lại 1 cái là xong).

## Cài dưới dạng Paseo plugin (khuyên dùng)

Cài nhanh nhất qua nút **Install plugin** trong Paseo trỏ tới
`https://github.com/luongndcoder/paseo-voice-vi`, hoặc bằng CLI:

```bash
paseo plugin install /path/to/paseo-voice-vi
paseo plugin ls   # chờ paseo-voice-vi => running
```

Sau đó mở màn **Vietnamese voice** trong Paseo (sidebar, hoặc ⌘K
"Open Vietnamese voice setup") và làm theo 3 bước:

1. **Speech model** — kiểm tra model vi-en đã có trên máy chưa.
2. **Microphone pipeline test** — chạy thử engine một lần cho chắc.
3. **Connect dictation** — trỏ dictation của Paseo vào worker, rồi **restart daemon**.

Xong là bấm mic nói được. Lưu ý hành vi:

- Chữ chỉ hiện khi **nhả mic** (model chạy offline theo từng đoạn, không có chữ live).
- Output viết **HOA** (do BPE tokens của model viết hoa: `▁LÀ`, `▁THE`).

## Chọn model (codeswitch | nemotron)

Worker chọn engine qua env `PASEO_VOICE_VI_MODEL` của daemon (mặc định `codeswitch`):

| Giá trị | Engine | Ghi chú |
| --- | --- | --- |
| `codeswitch` | NghiMe vi-en codeswitch Zipformer (~75 MB, bundle sẵn) | Streaming offline, nhẹ, đúng code-switch Việt-Anh |
| `nemotron` | NVIDIA Nemotron 3.5 streaming (~650 MB, tự tải) | Streaming realtime, đa ngữ; ONNX không chạy trên một số máy Mac (dùng bản MLX của voicescribe thay thế) |

Đổi trên từng máy (ví dụ máy mạnh dùng nemotron, Mac yếu dùng codeswitch):

```bash
# macOS (LaunchAgent plist của daemon): thêm vào EnvironmentVariables
#   <key>PASEO_VOICE_VI_MODEL</key><string>nemotron</string>
# Linux systemd: thêm vào EnvironmentFile / service env
PASEO_VOICE_VI_MODEL=nemotron
# rồi restart daemon. Màn Vietnamese voice hiện model đang active ở bước 1,
# nút test/tải luôn chạy đúng model đó.
```

## Cài tay (không qua plugin)

```bash
git clone https://github.com/luongndcoder/paseo-voice-vi.git ~/paseo-voice-vi
cd ~/paseo-voice-vi
npm install

# 1. Kiểm tra sherpa-onnx + model + engine khởi tạo được:
node scripts/doctor.mjs
# (model bundle sẵn trong repo; thiếu thì tự tải từ HuggingFace)

# 2. Test worker protocol không cần daemon:
node scripts/smoke-test.mjs

# 3. Trỏ daemon vào worker — thêm/sửa trong ~/.paseo/config.json:
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
| `node scripts/download-model.mjs [modelsDir]` | Resolve model codeswitch (mặc định `~/.paseo/models/local-speech`) |
| `node scripts/doctor.mjs [modelsDir]` | Kiểm tra sherpa-onnx + model + engine khởi tạo |
| `node scripts/smoke-test.mjs [modelsDir]` | Fork worker, test đủ vòng protocol (create→append→commit→close) |
| `bin/worker.mjs` | Entry point mà daemon fork |

## Ghi chú

- Worker chỉ phục vụ **dictation STT** (`session.create` kind `dictationStt`). Voice-mode
  STT/TTS/turn-detection vẫn do worker tích hợp sẵn của daemon đảm nhiệm.
- Trên Linux cần `patchelf` nếu RUNPATH của addon sherpa bị hỏng (loader tự xử lý).
