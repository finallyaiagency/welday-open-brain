do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_memory'
      and policyname = 'auth read business_memory'
  ) then
    create policy "auth read business_memory"
      on business_memory
      for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'business_memory'
      and policyname = 'service role all business_memory'
  ) then
    create policy "service role all business_memory"
      on business_memory
      for all
      to service_role
      using (true);
  end if;
end
$$;
