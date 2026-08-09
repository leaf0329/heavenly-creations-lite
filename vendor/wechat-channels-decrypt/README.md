# WeChat Channels decryption runtime

`wasm_video_decode.js` and `wasm_video_decode.wasm` are unmodified files from
[Evil0ctal/WeChat-Channels-Video-File-Decryption](https://github.com/Evil0ctal/WeChat-Channels-Video-File-Decryption),
used under the included MIT license. HCLite loads the official WeChat WASM in a
Node VM and uses only `WxIsaac64` to generate the 131072-byte keystream.

Upstream commit inspected when vendored: `main` on 2026-08-09.

