import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">注册成功！</CardTitle>
        <CardDescription>请查收确认邮件</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          你已成功注册。登录前请先查收邮件，点击确认链接激活账号。
        </p>
      </CardContent>
    </Card>
  );
}
