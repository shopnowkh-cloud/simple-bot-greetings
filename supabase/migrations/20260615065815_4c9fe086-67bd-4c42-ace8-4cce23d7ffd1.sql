create or replace function public.exec_sql(query_text text, query_params jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  p text[];
  n int;
  wrapped text;
begin
  p := case when jsonb_typeof(query_params) = 'array'
            then array(select jsonb_array_elements_text(query_params))
            else array[]::text[] end;
  n := coalesce(array_length(p, 1), 0);
  wrapped := 'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (' || query_text || ') t';

  begin
    case n
      when 0  then execute wrapped into result;
      when 1  then execute wrapped into result using p[1];
      when 2  then execute wrapped into result using p[1],p[2];
      when 3  then execute wrapped into result using p[1],p[2],p[3];
      when 4  then execute wrapped into result using p[1],p[2],p[3],p[4];
      when 5  then execute wrapped into result using p[1],p[2],p[3],p[4],p[5];
      when 6  then execute wrapped into result using p[1],p[2],p[3],p[4],p[5],p[6];
      when 7  then execute wrapped into result using p[1],p[2],p[3],p[4],p[5],p[6],p[7];
      when 8  then execute wrapped into result using p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8];
      when 9  then execute wrapped into result using p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9];
      else         execute wrapped into result using p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9],p[10];
    end case;
    return coalesce(result, '[]'::jsonb);
  exception when others then
    case n
      when 0  then execute query_text;
      when 1  then execute query_text using p[1];
      when 2  then execute query_text using p[1],p[2];
      when 3  then execute query_text using p[1],p[2],p[3];
      when 4  then execute query_text using p[1],p[2],p[3],p[4];
      when 5  then execute query_text using p[1],p[2],p[3],p[4],p[5];
      when 6  then execute query_text using p[1],p[2],p[3],p[4],p[5],p[6];
      when 7  then execute query_text using p[1],p[2],p[3],p[4],p[5],p[6],p[7];
      when 8  then execute query_text using p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8];
      when 9  then execute query_text using p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9];
      else         execute query_text using p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],p[9],p[10];
    end case;
    return '[]'::jsonb;
  end;
end;
$$;

revoke all on function public.exec_sql(text, jsonb) from public, anon, authenticated;
grant execute on function public.exec_sql(text, jsonb) to service_role;