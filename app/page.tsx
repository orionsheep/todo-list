"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, LogOut, Mic, MicOff, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Caveat } from "next/font/google";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

// 英文标题字体（Google Fonts），中文标题用系统楷体
const caveat = Caveat({ subsets: ["latin"], weight: ["600", "700"] });
const KAI_FONT = '"Kaiti SC", "STKaiti", serif';

// 纸墨手账配色（严格遵守视觉规范）
const INK = "#1C1911"; // 墨黑：主文字 / 描边
const INK_SOFT = "#7A7468"; // 次要文字
const PAPER = "#F5F0E8"; // 页面背景：奶油纸
const CARD = "#FAF6EF"; // 卡片：略亮的纸色
const ACCENT = "#E8634A"; // 暖橙红：只用于点睛
const HARD_SHADOW = "3px 4px 0 rgba(28, 25, 17, 0.16)";
const HARD_SHADOW_LG = "6px 6px 0 rgba(28, 25, 17, 0.16)";

// 便签浅底色轮换：便签黄 / 草绿 / 湖蓝 / 金（浅色版）
const NOTE_COLORS = ["#FBE8A6", "#DDE9D8", "#D8E6F0", "#F3E5B8"];

// 贴纸倾斜角度：-1.2deg ~ +1.5deg 之间交替
const ROTATIONS = [-1.2, 1.4, -0.8, 1.5, -1, 0.9];

// 附件图片存放的 bucket（private，RLS：只能传到自己 uid 文件夹，查看走签名 URL）
const BUCKET = "my-todo";

type Todo = {
  id: string; // 数据库里的 uuid
  text: string;
  done: boolean;
  image_url: string | null; // 附件在 bucket 里的路径（<uid>/<file>）
  due_date: string | null;
  priority: "高" | "中" | "低";
};

// 优先级标签配色（辅助点缀色）
const PRIORITY_STYLE: Record<Todo["priority"], { bg: string; label: string }> = {
  高: { bg: "#E8634A", label: "高" },
  中: { bg: "#D4A800", label: "中" },
  低: { bg: "#6B9E7A", label: "低" },
};

// 截止时间显示格式：M月d日 HH:mm，已过期追加「已过期」
function formatDue(due: string): { text: string; overdue: boolean } {
  const d = new Date(due);
  const overdue = d.getTime() < Date.now();
  const text = `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return { text: overdue ? `${text} · 已过期` : text, overdue };
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [input, setInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loadingTodos, setLoadingTodos] = useState(false);
  // 附件：路径 → 签名预览 URL 的缓存；正在上传的 todo id；放大查看的 URL
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  // AI 解析状态
  const [parsing, setParsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [smartHint, setSmartHint] = useState<string | null>(null);
  // 语音输入状态：idle | recording | transcribing
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "transcribing">("idle");
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const attachTargetId = useRef<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  // 私有 bucket 读图：路径 → 1 小时有效的签名预览 URL（带内存缓存）
  const getPreviewUrl = async (path: string): Promise<string | null> => {
    const cached = previewUrls[path];
    if (cached) return cached;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return null;
    setPreviewUrls((prev) => ({ ...prev, [path]: data.signedUrl }));
    return data.signedUrl;
  };

  // 拉取当前用户的待办（RLS 保证只返回自己的数据，eq user_id 是显式双保险）
  const fetchTodos = async (userId: string) => {
    setLoadingTodos(true);
    const { data, error } = await supabase
      .from("todos")
      .select("id, text, done, image_url, due_date, priority")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (!error && data) {
      setTodos(
        data.map((t) => ({
          id: t.id,
          text: t.text,
          done: t.done,
          image_url: t.image_url,
          due_date: t.due_date,
          priority: t.priority ?? "中",
        })),
      );
      // 给有附件的待办批量换签名预览 URL
      data.forEach((t) => {
        if (t.image_url) void getPreviewUrl(t.image_url);
      });
    }
    setLoadingTodos(false);
  };

  // 监听登录状态：已登录加载待办，退出清空
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) fetchTodos(data.user.id);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) {
        fetchTodos(u.id);
      } else {
        setTodos([]);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime 订阅：本设备之外的增/删/改实时同步到视图
  // （RLS 生效时订阅端只会收到当前用户自己行的变更；
  //   replica identity 为 default，DELETE 的 old 只含主键，取 id 即可）
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`todos-realtime-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "todos", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const r = payload.new as Todo;
            setTodos((prev) =>
              prev.some((t) => t.id === r.id)
                ? prev
                : [
                    ...prev,
                    {
                      id: r.id,
                      text: r.text,
                      done: r.done,
                      image_url: r.image_url,
                      due_date: r.due_date,
                      priority: r.priority ?? "中",
                    },
                  ],
            );
            if (r.image_url) void getPreviewUrl(r.image_url);
          } else if (payload.eventType === "UPDATE") {
            const r = payload.new as Todo;
            setTodos((prev) =>
              prev.map((t) =>
                t.id === r.id
                  ? {
                      id: r.id,
                      text: r.text,
                      done: r.done,
                      image_url: r.image_url,
                      due_date: r.due_date,
                      priority: r.priority ?? "中",
                    }
                  : t,
              ),
            );
            if (r.image_url) void getPreviewUrl(r.image_url);
          } else if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            setTodos((prev) => prev.filter((t) => t.id !== old.id));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // 语音输入：开始录音（最长 60 秒自动停止）
  const startRecording = async () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    if (voiceState !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSmartHint("当前浏览器不支持录音，请换 Chrome/Edge 试试");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setSmartHint("麦克风权限被拒绝，请在浏览器地址栏允许后重试");
      return;
    }

    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const mime = recorder.mimeType || "audio/webm";
      const blob = new Blob(audioChunksRef.current, { type: mime });
      await transcribeAudio(blob, mime);
    };

    recorder.start();
    setVoiceState("recording");
    setRecordSeconds(0);
    setSmartHint(null);
    recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    recordStopTimerRef.current = setTimeout(() => stopRecording(), 60_000);
  };

  // 停止录音并触发识别
  const stopRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (recordStopTimerRef.current) clearTimeout(recordStopTimerRef.current);
    recordTimerRef.current = null;
    recordStopTimerRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      setVoiceState("transcribing");
      recorder.stop(); // onstop 里继续走识别
    }
  };

  // 上传音频 → /api/transcribe → 文字填入输入框
  const transcribeAudio = async (blob: Blob, mime: string) => {
    try {
      const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
      const formData = new FormData();
      formData.append("file", blob, `recording.${ext}`);
      const resp = await fetch("/api/transcribe", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (resp.ok && typeof data.text === "string" && data.text.trim()) {
        setInput(data.text.trim());
        setSmartHint(null);
      } else if (resp.ok) {
        setSmartHint("没有听清内容，请再试一次");
      } else {
        setSmartHint(data.error || "识别失败，请重试");
      }
    } catch {
      setSmartHint("网络异常，识别失败，请重试");
    } finally {
      setVoiceState("idle");
      setRecordSeconds(0);
    }
  };

  // 麦克风按钮：录音中→停止，否则→开始
  const handleMicClick = () => {
    if (voiceState === "recording") {
      stopRecording();
    } else if (voiceState === "idle") {
      startRecording();
    }
  };

  // 退出登录（与 components/logout-button.tsx 相同的封装方式）
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  // 把一条结构化任务写入数据库并更新视图
  const insertTodo = async (item: {
    text: string;
    due_date: string | null;
    priority: Todo["priority"];
  }): Promise<boolean> => {
    const { data, error } = await supabase
      .from("todos")
      .insert({
        text: item.text,
        user_id: user!.id,
        due_date: item.due_date,
        priority: item.priority,
      })
      .select("id, text, done, image_url, due_date, priority")
      .single();
    if (!error && data) {
      setTodos((prev) => [
        ...prev,
        {
          id: data.id,
          text: data.text,
          done: data.done,
          image_url: data.image_url,
          due_date: data.due_date,
          priority: data.priority ?? "中",
        },
      ]);
      return true;
    }
    return false;
  };

  // 直接添加：不经过 AI，输入原样保存为一条普通待办
  const addTodo = async () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    const text = input.trim();
    if (!text || adding) return;
    setAdding(true);
    const ok = await insertTodo({ text, due_date: null, priority: "中" });
    if (ok) setInput("");
    setAdding(false);
  };

  // AI 解析：把自然语言拆成多条任务分别写入
  // 解析失败时提示并自动按「直接添加」处理，不打断用户
  const smartParse = async () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    const raw = input.trim();
    if (!raw || parsing) return;
    setParsing(true);

    let items: { text: string; due_date: string | null; priority: Todo["priority"] }[] | null =
      null;
    try {
      const resp = await fetch("/api/parse-todo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: raw }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data?.todos) && data.todos.length > 0) {
          items = data.todos;
        }
      }
    } catch {
      // 网络异常走回退
    }

    if (!items) {
      // 回退：提示后按直接添加处理
      setSmartHint("AI 解析失败，已按普通待办直接添加");
      items = [{ text: raw, due_date: null, priority: "中" }];
    } else {
      setSmartHint(null);
    }

    let okCount = 0;
    for (const item of items) {
      const ok = await insertTodo(item);
      if (ok) okCount += 1;
    }
    if (okCount > 0) setInput("");
    setParsing(false);
  };

  // 上传图片到 my-todo bucket 的用户 uid 目录，返回存储路径
  const uploadImage = async (file: File, userId: string): Promise<string | null> => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) return null;
    return path;
  };

  // 给已有待办添加/替换附件（每条最多一个）
  const pickAttachFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const todoId = attachTargetId.current;
    attachTargetId.current = null;
    if (!file || !todoId || !user) return;

    setUploadingId(todoId);
    const path = await uploadImage(file, user.id);
    if (path) {
      const backup = todos;
      setTodos((prev) =>
        prev.map((t) => (t.id === todoId ? { ...t, image_url: path } : t)),
      );
      const { error } = await supabase
        .from("todos")
        .update({ image_url: path })
        .eq("id", todoId)
        .eq("user_id", user.id);
      if (error) {
        setTodos(backup);
      } else {
        // 新图立即换签名 URL 用于显示
        void getPreviewUrl(path);
      }
    } else {
      alert("图片上传失败，请重试");
    }
    setUploadingId(null);
  };

  // 移除附件（只清数据库字段，bucket 里的文件保留不管）
  const removeImage = async (todoId: string) => {
    if (!user) return;
    const backup = todos;
    setTodos((prev) =>
      prev.map((t) => (t.id === todoId ? { ...t, image_url: null } : t)),
    );
    const { error } = await supabase
      .from("todos")
      .update({ image_url: null })
      .eq("id", todoId)
      .eq("user_id", user.id);
    if (error) setTodos(backup);
  };

  // 勾选完成 / 取消完成：乐观更新，失败回滚（eq user_id 双保险）
  const toggleTodo = async (id: string) => {
    const target = todos.find((t) => t.id === id);
    if (!target || !user) return;
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    const { error } = await supabase
      .from("todos")
      .update({ done: !target.done })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) {
      setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: target.done } : t)));
    }
  };

  // 删除待办：乐观删除，失败回滚
  const removeTodo = async (id: string) => {
    if (!user) return;
    const backup = todos;
    setTodos((prev) => prev.filter((t) => t.id !== id));
    const { error } = await supabase
      .from("todos")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) setTodos(backup);
  };

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setEditingText(todo.text);
  };

  // 编辑保存：Enter / 失焦触发；空文本不保存；失败回滚
  const saveEdit = async () => {
    if (editingId === null || !user) return;
    const text = editingText.trim();
    const id = editingId;
    setEditingId(null);
    setEditingText("");
    if (!text) return;
    const backup = todos;
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, text } : t)));
    const { error } = await supabase
      .from("todos")
      .update({ text })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) setTodos(backup);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const doneCount = todos.filter((t) => t.done).length;

  return (
    <main
      className="min-h-screen w-full px-6 py-14 sm:px-10"
      style={{
        backgroundColor: PAPER,
        // 点阵纸纹：radial-gradient 小圆点，间距 26px
        backgroundImage: "radial-gradient(#E4DCCB 1.2px, transparent 1.2px)",
        backgroundSize: "26px 26px",
        color: INK,
        lineHeight: 1.6,
      }}
    >
      {/* 贴纸通用样式：倾斜用 CSS 变量驱动，hover 回正上移；新元素弹入 */}
      <style>{`
        .sticker-card {
          transform: rotate(var(--r, 0deg)) translateY(var(--o, 0px));
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          animation: sticker-pop 250ms ease both;
        }
        .sticker-card:hover {
          transform: rotate(0deg) translateY(calc(var(--o, 0px) - 4px));
          box-shadow: ${HARD_SHADOW_LG};
        }
        @keyframes sticker-pop {
          0% { transform: rotate(var(--r, 0deg)) translateY(var(--o, 0px)) scale(0.7); }
          70% { transform: rotate(var(--r, 0deg)) translateY(var(--o, 0px)) scale(1.05); }
          100% { transform: rotate(var(--r, 0deg)) translateY(var(--o, 0px)) scale(1); }
        }
        .sticker-btn { transition: all 0.15s ease; }
        .sticker-btn:active { transform: scale(0.94); }
        @keyframes mic-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>

      <div className="mx-auto w-full max-w-4xl">
        {/* 右上角：未登录显示 登录/注册，已登录显示 邮箱 + 退出登录 */}
        <div className="flex items-center justify-end gap-3">
          {user ? (
            <>
              <span
                className="hidden items-center px-2 text-sm sm:flex"
                style={{ color: INK_SOFT }}
              >
                {user.email}
              </span>
              <button
                onClick={handleLogout}
                className="sticker-btn flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium"
                style={{
                  backgroundColor: CARD,
                  border: `1.5px solid ${INK}`,
                  boxShadow: HARD_SHADOW,
                  transform: "rotate(-1deg)",
                }}
              >
                <LogOut className="h-4 w-4" strokeWidth={2.5} />
                退出登录
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="sticker-btn rounded-full px-4 py-1.5 text-sm font-medium"
                style={{
                  backgroundColor: CARD,
                  border: `1.5px solid ${INK}`,
                  boxShadow: HARD_SHADOW,
                  transform: "rotate(-1deg)",
                }}
              >
                登录
              </Link>
              <Link
                href="/auth/sign-up"
                className="sticker-btn rounded-full px-4 py-1.5 text-sm font-medium text-white"
                style={{
                  backgroundColor: ACCENT,
                  border: `1.5px solid ${INK}`,
                  boxShadow: HARD_SHADOW,
                  transform: "rotate(1.2deg)",
                }}
              >
                注册
              </Link>
            </>
          )}
        </div>

        {/* 标题区 */}
        <div className="flex flex-col items-center gap-3">
          <span
            className={`${caveat.className} rounded-full px-4 py-0.5 text-xl font-semibold`}
            style={{
              backgroundColor: "#FBE8A6",
              border: `1.5px solid ${INK}`,
              boxShadow: HARD_SHADOW,
              transform: "rotate(-1.2deg)",
            }}
          >
            To-Do
          </span>
          <h1
            className="text-4xl sm:text-5xl"
            style={{ fontFamily: KAI_FONT, transform: "rotate(0.6deg)" }}
          >
            手账待办
          </h1>
          <p className="text-sm" style={{ color: INK_SOFT }}>
            写一条，贴一条，做完打个勾
          </p>
        </div>

        {/* 智能输入框 + 「AI 解析」「直接添加」两个按钮 */}
        <div className="mt-10">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex h-12 min-w-0 flex-1 items-center gap-2 px-4"
              style={{
                backgroundColor: CARD,
                border: `1.5px solid ${INK}`,
                borderRadius: 16,
                boxShadow: HARD_SHADOW,
                flexBasis: 260,
              }}
            >
              <Sparkles
                className="shrink-0"
                strokeWidth={2.2}
                style={{ width: 18, height: 18, color: ACCENT }}
              />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") smartParse();
                }}
                placeholder={
                  user ? "试试：明天买菜，后天早上八点交作业，很重要" : "先登录，再写待办"
                }
                className="min-w-0 flex-1 bg-transparent text-base outline-none"
              />
              {/* 麦克风：语音输入（输入框内侧右边） */}
              <button
                onClick={handleMicClick}
                disabled={voiceState === "transcribing"}
                aria-label={voiceState === "recording" ? "停止录音" : "语音输入"}
                title={voiceState === "recording" ? "点击停止" : "语音输入"}
                className="sticker-btn flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm disabled:opacity-60"
                style={
                  voiceState === "recording"
                    ? {
                        color: "#fff",
                        backgroundColor: ACCENT,
                        border: `1.5px solid ${INK}`,
                        animation: "mic-pulse 1s ease-in-out infinite",
                      }
                    : {
                        color: INK,
                        backgroundColor: "#FBE8A6",
                        border: `1.5px solid ${INK}`,
                      }
                }
              >
                {voiceState === "transcribing" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} />
                    <span className="hidden sm:inline">识别中...</span>
                  </>
                ) : voiceState === "recording" ? (
                  <>
                    <MicOff className="h-4 w-4" strokeWidth={2.2} />
                    <span>{recordSeconds}s</span>
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" strokeWidth={2.2} />
                    <span className="hidden sm:inline">语音</span>
                  </>
                )}
              </button>
            </div>
            {/* AI 解析按钮 */}
            <button
              onClick={smartParse}
              disabled={parsing || adding}
              aria-label="AI 解析"
              className="sticker-btn flex h-12 items-center gap-1.5 rounded-full px-5 font-medium text-white disabled:opacity-60"
              style={{
                backgroundColor: ACCENT,
                border: `1.5px solid ${INK}`,
                boxShadow: HARD_SHADOW,
              }}
            >
              {parsing ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.5} />
                  解析中...
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5" strokeWidth={2.5} />
                  AI 解析
                </>
              )}
            </button>
            {/* 直接添加按钮 */}
            <button
              onClick={addTodo}
              disabled={adding || parsing}
              aria-label="直接添加"
              className="sticker-btn flex h-12 items-center gap-1.5 rounded-full px-5 font-medium disabled:opacity-60"
              style={{
                backgroundColor: "#FBE8A6",
                border: `1.5px solid ${INK}`,
                boxShadow: HARD_SHADOW,
                color: INK,
              }}
            >
              {adding ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.5} />
                  添加中...
                </>
              ) : (
                <>
                  <Plus className="h-5 w-5" strokeWidth={2.5} />
                  直接添加
                </>
              )}
            </button>
          </div>
          {smartHint && (
            <p className="mt-2 text-sm" style={{ color: ACCENT }}>
              {smartHint}
            </p>
          )}
        </div>

        {/* 计数徽章（胶囊标签） */}
        {todos.length > 0 && (
          <div className="mt-6 flex justify-center">
            <span
              className="rounded-full px-4 py-1 text-sm"
              style={{
                backgroundColor: "#FBE8A6",
                border: `1.5px solid ${INK}`,
                boxShadow: HARD_SHADOW,
                transform: "rotate(1deg)",
              }}
            >
              共 {todos.length} 条 · 已完成{" "}
              <span style={{ color: ACCENT, fontWeight: 700 }}>{doneCount}</span>
            </span>
          </div>
        )}

        {/* 待办列表 / 空状态 */}
        {todos.length === 0 ? (
          <p
            className="mt-16 text-center text-2xl"
            style={{ fontFamily: KAI_FONT, color: INK_SOFT }}
          >
            {!user
              ? "登录后制定Todo"
              : loadingTodos
                ? "正在翻开你的手账..."
                : "暂无待办，写一条贴上去吧"}
          </p>
        ) : (
          <ul className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {todos.map((todo, i) => {
              const isEditing = editingId === todo.id;

              return (
                <li
                  key={todo.id}
                  className="sticker-card group relative px-4 py-4"
                  style={
                    {
                      backgroundColor: NOTE_COLORS[i % NOTE_COLORS.length],
                      border: `1.5px solid ${INK}`,
                      borderRadius: 16,
                      boxShadow: HARD_SHADOW,
                      // 轻微倾斜 + 奇偶位错落
                      "--r": `${ROTATIONS[i % ROTATIONS.length]}deg`,
                      "--o": `${i % 2 === 1 ? 14 : 0}px`,
                      // 完成后整卡变淡
                      opacity: todo.done ? 0.55 : 1,
                      transition: "opacity 0.15s ease",
                    } as React.CSSProperties
                  }
                >
                  <div className="flex items-start gap-3">
                    {/* 勾选 */}
                    <button
                      onClick={() => toggleTodo(todo.id)}
                      aria-label={todo.done ? "标记为未完成" : "标记为完成"}
                      className="sticker-btn mt-0.5 flex shrink-0 items-center justify-center rounded-full"
                      style={{
                        width: 22,
                        height: 22,
                        border: `1.5px solid ${todo.done ? ACCENT : INK}`,
                        backgroundColor: todo.done ? ACCENT : "transparent",
                        color: "#fff",
                      }}
                    >
                      {todo.done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </button>

                    {/* 文本 / 编辑态 */}
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit();
                          if (e.key === "Escape") cancelEdit();
                        }}
                        onBlur={saveEdit}
                        className="w-full min-w-0 flex-1 px-1.5 py-0.5 text-base outline-none"
                        style={{
                          backgroundColor: "#fff",
                          border: `1.5px solid ${INK}`,
                          borderRadius: 8,
                        }}
                      />
                    ) : (
                      <span className="min-w-0 flex-1">
                        <span
                          className="break-words text-base"
                          style={{
                            textDecoration: todo.done ? "line-through" : "none",
                            textDecorationColor: ACCENT,
                            textDecorationThickness: 2,
                            color: todo.done ? INK_SOFT : INK,
                          }}
                        >
                          {todo.text}
                        </span>
                        {/* 截止时间 + 优先级标签 */}
                        {(todo.due_date || todo.priority !== "中") && (
                          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {todo.priority !== "中" && (
                              <span
                                className="rounded-full px-2 py-0.5 text-xs text-white"
                                style={{
                                  backgroundColor: PRIORITY_STYLE[todo.priority].bg,
                                  border: `1.5px solid ${INK}`,
                                }}
                              >
                                {PRIORITY_STYLE[todo.priority].label}优先级
                              </span>
                            )}
                            {todo.due_date &&
                              (() => {
                                const due = formatDue(todo.due_date);
                                return (
                                  <span
                                    className="rounded-full px-2 py-0.5 text-xs"
                                    style={{
                                      backgroundColor:
                                        due.overdue && !todo.done ? "#E8634A" : "#4A7FA5",
                                      color: "#fff",
                                      border: `1.5px solid ${INK}`,
                                    }}
                                  >
                                    {due.text}
                                  </span>
                                );
                              })()}
                          </span>
                        )}
                      </span>
                    )}

                    {/* 编辑 / 删除 */}
                    {!isEditing && (
                      <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100">
                        <button
                          onClick={() => startEdit(todo)}
                          aria-label="编辑待办"
                          className="sticker-btn rounded-lg p-1.5"
                          style={{ color: INK_SOFT }}
                        >
                          <Pencil className="h-4 w-4" strokeWidth={2.5} />
                        </button>
                        <button
                          onClick={() => removeTodo(todo.id)}
                          aria-label="删除待办"
                          className="sticker-btn rounded-lg p-1.5 hover:!text-[#E8634A]"
                          style={{ color: INK_SOFT }}
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={2.5} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* 附件图片（点击放大）/ 添加附件胶囊按钮 */}
                  {todo.image_url ? (
                    <div className="relative mt-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrls[todo.image_url]}
                        alt="待办附件"
                        onClick={() => {
                          const url = previewUrls[todo.image_url!];
                          if (url) setLightboxUrl(url);
                        }}
                        className="w-full cursor-zoom-in rounded-lg object-cover"
                        style={{
                          border: `1.5px solid ${INK}`,
                          maxHeight: 160,
                          opacity: todo.done ? 0.6 : 1,
                        }}
                      />
                      <button
                        onClick={() => removeImage(todo.id)}
                        aria-label="移除附件图片"
                        className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white"
                        style={{ backgroundColor: ACCENT, border: `1px solid ${INK}` }}
                      >
                        <X className="h-3 w-3" strokeWidth={3} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        attachTargetId.current = todo.id;
                        attachInputRef.current?.click();
                      }}
                      disabled={uploadingId === todo.id}
                      className="sticker-btn mt-3 flex items-center gap-1.5 rounded-full px-4 text-sm disabled:opacity-60"
                      style={{
                        minHeight: 36,
                        color: INK,
                        backgroundColor: "#FBE8A6",
                        border: `1.5px solid ${INK}`,
                        boxShadow: HARD_SHADOW,
                      }}
                    >
                      {uploadingId === todo.id ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
                          上传中…
                        </>
                      ) : (
                        <>
                          <ImagePlus className="h-4 w-4" strokeWidth={2.5} />
                          加个图片
                        </>
                      )}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 给已有待办添加附件的隐藏文件选择框 */}
      <input
        ref={attachInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={pickAttachFile}
      />

      {/* 图片放大查看（灯箱）：点击任意处关闭 */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-6"
          style={{ backgroundColor: "rgba(28, 25, 17, 0.72)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="附件大图"
            className="max-h-full max-w-full rounded-lg object-contain"
            style={{ border: `1.5px solid ${INK}` }}
          />
        </div>
      )}
    </main>
  );
}
