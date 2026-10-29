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

Daemon chỉ cần biết **provider `external` + đường dẫn worker**; toàn bộ phần ASR
nằm trong gói này. Model là bản custom build (không có link tải công khai) nên
worker resolve từ disk: bản copy trong `meeting-minutes`, thư mục models của
daemon, hoặc env `PASEO_VOICE_VI_CODESWITCH_DIR`.

## Yêu cầu

- Node.js ≥ 23.6 (chạy TypeScript trực tiếp bằng type stripping; khuyến nghị Node 24+).
- Paseo daemon bản fork có hỗ trợ `stt.provider: "external"` (Paseo stock không có).

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

## Cài tay (không qua plugin)

```bash
git clone https://github.com/luongndcoder/paseo-voice-vi.git ~/paseo-voice-vi
cd ~/paseo-voice-vi
npm install

# 1. Kiểm tra sherpa-onnx + model + engine khởi tạo được:
node scripts/doctor.mjs
# (model resolve từ meeting-minutes / models dir / PASEO_VOICE_VI_CODESWITCH_DIR)

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
