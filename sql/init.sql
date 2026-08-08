-- =============================================
-- 我的 Todo List - 数据库初始化
-- 项目: todolist (tgfyrzkpmpkmosgvfyzw)
-- 内容: todos 表 + updated_at 触发器 + RLS 用户数据隔离 + 索引
-- 说明: 未登录用户被 RLS 拦截（auth.uid() 为 null，所有策略不通过），
--       只有登录用户才能增删改查自己的待办
-- =============================================

-- 1. todos 表
create table if not exists public.todos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  text        text not null check (char_length(text) > 0),
  done        boolean not null default false,
  image_url   text, -- 附件图片预览地址（my-todo bucket，每条 todo 最多一个）
  due_date    timestamptz, -- 截止时间（智能添加解析得出，可空）
  priority    text not null default '中' check (priority in ('高', '中', '低')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.todos is '用户待办事项';
comment on column public.todos.user_id is '所属用户（auth.users）';

-- 2. updated_at 自动更新触发器
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at
  before update on public.todos
  for each row
  execute function public.set_updated_at();

-- 3. 开启行级安全（RLS）
alter table public.todos enable row level security;

-- 4. RLS 策略：每个用户只能读写自己的待办
--    未登录时 auth.uid() = null，全部不通过 → 天然挡住游客
create policy "Users can select own todos"
  on public.todos for select
  using (auth.uid() = user_id);

create policy "Users can insert own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

create policy "Users can update own todos"
  on public.todos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own todos"
  on public.todos for delete
  using (auth.uid() = user_id);

-- 5. 索引：按用户查列表 + 按创建时间排序
create index if not exists todos_user_id_idx on public.todos (user_id);
create index if not exists todos_created_at_idx on public.todos (created_at);

-- 6. 开启实时同步（加入 supabase_realtime publication）
alter publication supabase_realtime add table public.todos;
