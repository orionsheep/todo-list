import { NextResponse } from "next/server";

// DeepSeek API（OpenAI 兼容格式）。Key 只从服务端环境变量读取，绝不进前端 bundle。
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-chat";

type ParsedTodo = {
  text: string;
  due_date: string | null;
  priority: "高" | "中" | "低";
};

function buildPrompt(text: string): string {
  const now = new Date().toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  });
  return `你是待办事项解析助手。现在是北京时间 ${now}。

请把用户输入的自然语言解析成待办事项列表。一句话里可能包含多个任务（用逗号、句号、顿号、分号分隔，或语义上明显是多件事），要拆成多条；只有一条任务就返回只有一个元素的数组。

对每个任务抽取：
- text：任务内容（去掉时间、重要性描述，只留要做的事，简洁）
- due_date：截止时间，ISO 8601 格式带时区偏移（如 2026-08-09T15:00:00+08:00）。根据当前时间推算"明天""后天""下周"等相对时间。没提到时间就填 null
- priority：优先级，只能填"高"、"中"、"低"。出现"重要""紧急""务必""赶紧"等词用"高"；语气平淡的默认"中"；明确表示"不急""有空再"用"低"

只返回 JSON，不要任何多余内容、不要用 markdown 代码块包裹。格式：
{"todos":[{"text":"任务内容","due_date":"ISO时间或null","priority":"高/中/低"}]}

用户输入：${text}`;
}

// 从模型输出中提取 JSON（容错：可能带 ```json 围栏或前后多余文字）
function extractJson(raw: string): { todos: ParsedTodo[] } | null {
  const cleaned = raw.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed?.todos) || parsed.todos.length === 0) return null;
    // 逐条校验 + 规整
    const todos: ParsedTodo[] = [];
    for (const item of parsed.todos) {
      if (typeof item?.text !== "string" || !item.text.trim()) continue;
      const priority =
        item.priority === "高" || item.priority === "低" ? item.priority : "中";
      let dueDate: string | null = null;
      if (typeof item.due_date === "string" && item.due_date) {
        const d = new Date(item.due_date);
        if (!Number.isNaN(d.getTime())) dueDate = d.toISOString();
      }
      todos.push({ text: item.text.trim(), due_date: dueDate, priority });
    }
    return todos.length > 0 ? { todos } : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "服务端未配置 DEEPSEEK_API_KEY" }, { status: 500 });
  }

  let text = "";
  try {
    const body = await request.json();
    text = typeof body?.text === "string" ? body.text.trim() : "";
  } catch {
    // 非法 JSON 按空文本处理
  }
  if (!text) {
    return NextResponse.json({ error: "缺少要解析的文本" }, { status: 400 });
  }

  try {
    const resp = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: buildPrompt(text) }],
        response_format: { type: "json_object" },
        temperature: 0.1,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return NextResponse.json(
        { error: `DeepSeek API 返回 ${resp.status}`, detail: detail.slice(0, 300) },
        { status: 502 },
      );
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(content);
    if (!parsed) {
      return NextResponse.json({ error: "模型返回内容无法解析" }, { status: 502 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      { error: isTimeout ? "DeepSeek API 请求超时" : "调用 DeepSeek API 失败" },
      { status: 502 },
    );
  }
}
