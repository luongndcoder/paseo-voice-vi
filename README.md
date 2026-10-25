# paseo-voice-vi

Standalone Vietnamese dictation (ASR/STT) cho Paseo — gói riêng, cài được trên bất kỳ laptop
nào mà không cần dùng daemon fork. Chạy sherpa-onnx Nemotron streaming ASR on-device
(offline, microphone → text ngay trên máy) và nói chuyện với daemon Paseo qua worker
protocol có sẵn.

## Kiến trúc

```
Paseo app (composer mic)
   │  dictation RPC
   ▼
Paseo daemon  ──fork IPC (local-speech worker protocol)──▶  paseo-voice-vi worker
  (provider "external")                                     sherpa-onnx + model vi
```

Daemon chỉ cần biết **provider `external` + đường dẫn worker module**; toàn bộ phần ASR
(model tiếng Việt, sherpa-onnx, streaming) nằm trong gói này. Gói dùng cùng một models dir
với daemon nên model tải về dùng chung.

## Yêu cầu

- Node.js ≥ 23.6 (chạy TypeScript trực tiếp bằng type stripping; khuyến nghị Node 24+).
- Paseo daemon bản fork mới (có hỗ trợ `stt.provider: "external"`).

## Cài trên máy laptop khác

```bash
# 1. Copy/cài gói (git clone hoặc npm pack từ máy chính)
git clone https://github.com/luongndcoder/paseo-voice-vi.git ~/paseo-voice-vi
cd ~/paseo-voice-vi
npm install

# 2. Kiểm tra sherpa-onnx chạy được + tải model tiếng Việt (~200MB, một lần duy nhất)
node scripts/doctor.mjs
# hoặc chủ động tải trước:
node scripts/download-model.mjs

# 3. Test worker protocol không cần daemon:
node scripts/smoke-test.mjs

# 4. Trỏ daemon vào worker — thêm/sửa trong ~/.paseo/config.json:
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
# (hoặc đặt env PASEO_DICTATION_EXTERNAL_STT_COMMAND=<path> cho daemon)

# 5. Restart daemon (LaunchAgent/kickstart), mở Paseo và dictation như bình thường.
```

Gỡ: trả `provider` về `"local"` trong config và restart daemon. Thư mục gói + model
(`~/.paseo/models/local-speech/nemotron-3.5-560ms-int8`) có thể xóa tự do.

## Scripts

| Script | Chức năng |
| --- | --- |
| `node scripts/download-model.mjs [modelsDir]` | Tải model Nemotron vi (mặc định `~/.paseo/models/local-speech`) |
| `node scripts/doctor.mjs [modelsDir]` | Kiểm tra sherpa-onnx + model + engine khởi tạo |
| `node scripts/smoke-test.mjs [modelsDir]` | Fork worker, test đủ vòng protocol (create→append→commit→close) |
| `bin/worker.mjs` | Entry point mà daemon fork |

## Ghi chú

- Worker chỉ phục vụ **dictation STT** (`session.create` kind `dictationStt`). Voice-mode
  STT/TTS/turn-detection vẫn do worker tích hợp sẵn của daemon đảm nhiệm.
- Model tự tải lần đầu khi daemon tạo session nếu chưa có (cần mạng lần đầu).
- Trên Linux cần `patchelf` nếu RUNPATH của addon sherpa bị hỏng (loader tự xử lý).
