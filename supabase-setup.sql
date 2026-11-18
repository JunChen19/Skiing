-- 雪线 SNOWLINE — 全球共享排行榜建表脚本
-- 用法：Supabase 控制台 → SQL Editor → 粘贴本文件全部内容 → Run
-- 然后到 Settings → API 复制 Project URL 和 anon public key，
-- 填入 index.html 顶部的 window.SKI_CONFIG（或 src/config.js 后重新 node build.js）

create table if not exists public.scores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  score      integer not null,
  created_at timestamptz not null default now(),
  constraint scores_name_len  check (char_length(name) between 1 and 16),
  constraint scores_name_safe check (name !~ '[<>&"''`/]'),
  constraint scores_score_ok  check (score between 0 and 10000000)
);

-- 排行榜查询加速
create index if not exists scores_score_desc_idx on public.scores (score desc);

alter table public.scores enable row level security;

-- 任何人可读（排行榜展示）
drop policy if exists "scores_select_anon" on public.scores;
create policy "scores_select_anon"
  on public.scores for select
  to anon, authenticated
  using (true);

-- 匿名只能插入合法成绩（分数由服务端约束限界，无法改别人的记录）
drop policy if exists "scores_insert_anon" on public.scores;
create policy "scores_insert_anon"
  on public.scores for insert
  to anon, authenticated
  with check (true);

-- 不开放 update / delete —— 成绩不可篡改、不可删除
-- （如需清理脏数据，请在 Supabase 控制台用 service_role 手动处理）
