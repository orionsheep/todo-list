-- =============================================
-- my-todo Storage bucket + 门禁策略
-- 项目: todolist (tgfyrzkpmpkmosgvfyzw)
-- 用途: 待办附件图片；每个登录用户只能操作自己 uid 文件夹下的文件
-- 已通过 migration create_my_todo_bucket_with_policies 执行
-- =============================================

-- 1. my-todo bucket：只允许图片（MIME image/*），private 模式（查看走 RLS）
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('my-todo', 'my-todo', false, array['image/*'])
on conflict (id) do nothing;

-- 2. 门禁策略：登录用户只能操作自己 uid 命名的文件夹（name 的第一段路径 = uid）
--    未登录 auth.uid() = null，全部不通过

create policy "Users can upload to own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'my-todo'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can view own files"
  on storage.objects for select
  using (
    bucket_id = 'my-todo'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own files"
  on storage.objects for delete
  using (
    bucket_id = 'my-todo'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
