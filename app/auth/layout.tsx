import { ArrowLeft } from "lucide-react";
import Link from "next/link";

// 与首页一致的纸墨手账配色
const INK = "#1C1911";
const PAPER = "#F5F0E8";
const CARD = "#FAF6EF";
const HARD_SHADOW = "3px 4px 0 rgba(28, 25, 17, 0.16)";

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className="flex min-h-screen w-full flex-col"
      style={{
        backgroundColor: PAPER,
        backgroundImage: "radial-gradient(#E4DCCB 1.2px, transparent 1.2px)",
        backgroundSize: "26px 26px",
        color: INK,
        lineHeight: 1.6,
      }}
    >
      {/* 顶部 header：返回首页 */}
      <header className="flex w-full items-center px-6 pt-6 sm:px-10">
        <Link
          href="/"
          className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150 hover:-translate-y-0.5"
          style={{
            backgroundColor: CARD,
            border: `1.5px solid ${INK}`,
            boxShadow: HARD_SHADOW,
            transform: "rotate(-1deg)",
            color: INK,
          }}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
          返回首页
        </Link>
      </header>

      {/* 内容区：居中容器 + 贴纸风卡片描边（作用于表单里的 shadcn Card） */}
      <div className="flex flex-1 items-center justify-center p-6 md:p-10">
        <div className="w-full max-w-sm auth-card-scope">{children}</div>
      </div>

      {/* 让 shadcn Card 贴上手账质感：墨线描边 + 硬边投影 + 纸色底。
          手账风是固定浅色系，强制亮色变量，不跟随系统 dark mode */}
      <style>{`
        .auth-card-scope {
          color-scheme: light;
          --background: ${CARD};
          --foreground: ${INK};
          --card: ${CARD};
          --card-foreground: ${INK};
          --popover: ${CARD};
          --popover-foreground: ${INK};
          --muted-foreground: #7A7468;
          --input: transparent;
          --border: ${INK};
          --primary: #E8634A;
          --primary-foreground: #fff;
        }
        .auth-card-scope [data-slot="card"] {
          background-color: ${CARD};
          border: 1.5px solid ${INK};
          border-radius: 16px;
          box-shadow: ${HARD_SHADOW};
        }
        .auth-card-scope [data-slot="card-title"] {
          font-family: "Kaiti SC", "STKaiti", serif;
        }
        .auth-card-scope input {
          border: 1.5px solid ${INK} !important;
          border-radius: 10px !important;
          background-color: #fff !important;
        }
        .auth-card-scope button[type="submit"] {
          background-color: #E8634A !important;
          color: #fff !important;
          border: 1.5px solid ${INK} !important;
          border-radius: 9999px !important;
          box-shadow: ${HARD_SHADOW};
          transition: all 0.15s ease;
        }
        .auth-card-scope button[type="submit"]:hover {
          transform: translateY(-2px);
          box-shadow: 4px 5px 0 rgba(28, 25, 17, 0.16);
        }
        .auth-card-scope button[type="submit"]:active {
          transform: scale(0.97);
        }
        .auth-card-scope a {
          color: #4A7FA5;
        }
      `}</style>
    </div>
  );
}
