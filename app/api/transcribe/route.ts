import { NextRequest, NextResponse } from "next/server";

// 语音输入：音频文件 → 硅基流动 SenseVoiceSmall → 识别文字
// 安全说明：SILICONFLOW_API_KEY 只在这个服务端路由里使用，
// 不带 NEXT_PUBLIC_ 前缀，永远不会进入前端 bundle。

const SILICONFLOW_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
const MODEL = "FunAudioLLM/SenseVoiceSmall";

// 浏览器 MediaRecorder 常见 MIME → 文件后缀（后缀与 Content-Type 必须和真实格式一致）
const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/webm;codecs=opus": "webm",
  "audio/ogg": "ogg",
  "audio/ogg;codecs=opus": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

export async function POST(request: NextRequest) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "服务端未配置 SILICONFLOW_API_KEY" },
      { status: 500 },
    );
  }

  let audioFile: File | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (file instanceof File && file.size > 0) {
      audioFile = file;
    }
  } catch {
    // fallthrough
  }
  if (!audioFile) {
    return NextResponse.json({ error: "缺少音频文件" }, { status: 400 });
  }

  // 规范化文件名：保证后缀与真实 MIME 一致（浏览器录的一般是 webm/opus）
  const mime = audioFile.type || "audio/webm";
  const ext = EXT_BY_MIME[mime] ?? EXT_BY_MIME[mime.split(";")[0]] ?? "webm";
  const buffer = await audioFile.arrayBuffer();

  const upstream = new FormData();
  upstream.append(
    "file",
    new Blob([buffer], { type: mime.split(";")[0] }),
    `recording.${ext}`,
  );
  upstream.append("model", MODEL);

  try {
    const resp = await fetch(SILICONFLOW_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(60_000),
    });

    const data = await resp.json().catch(() => null);

    if (!resp.ok) {
      const msg =
        data?.message || data?.error?.message || `HTTP ${resp.status}`;
      console.error("SiliconFlow error:", resp.status, msg);
      // 格式不支持 → 明确告诉前端（理论上按真实后缀传就不会触发）
      if (String(msg).includes("format") || String(msg).includes("格式")) {
        return NextResponse.json(
          { error: `音频格式不支持（${ext}），请重试` },
          { status: 415 },
        );
      }
      if (resp.status === 401) {
        return NextResponse.json(
          { error: "语音识别服务认证失败" },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: `识别服务异常（${resp.status}）` },
        { status: 502 },
      );
    }

    const text: string = (data?.text ?? "").trim();
    return NextResponse.json({ text });
  } catch (err) {
    console.error("transcribe failed:", err);
    return NextResponse.json(
      { error: "识别失败，请稍后再试" },
      { status: 502 },
    );
  }
}
