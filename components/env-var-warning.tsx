import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

export function EnvVarWarning() {
  return (
    <div className="flex gap-4 items-center">
      <Badge variant={"outline"} className="font-normal">
        需要配置 Supabase 环境变量
      </Badge>
      <div className="flex gap-2">
        <Button size="sm" variant={"outline"} disabled>
          登录
        </Button>
        <Button size="sm" variant={"default"} disabled>
          注册
        </Button>
      </div>
    </div>
  );
}
