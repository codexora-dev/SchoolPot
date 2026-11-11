import { json, protect, readBody } from '../_shared/http.ts';
const cache = new Map<string, { expires: number; items: unknown[] }>();
const plain = (text: unknown) =>
  String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .slice(0, 10000);
Deno.serve(async (req: Request) => {
  let origin = '';
  try {
    const ctx = await protect(req);
    origin = ctx.origin;
    if (ctx.preflight) return ctx.preflight;
    const body = await readBody(req);
    const { kind, day } = body;
    if (
      !['meals', 'schedule'].includes(kind) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      Number.isNaN(Date.parse(day))
    )
      return json({ error: 'INVALID_INPUT' }, 400, origin);
    const { error } = await ctx.client!.rpc('community', {
      p_action: 'neis_access',
      p_payload: {},
    });
    if (error) return json({ error: 'FORBIDDEN_OR_RATE_LIMIT' }, 403, origin);
    const apiKey = Deno.env.get('NEIS_API_KEY'),
      office = Deno.env.get('NEIS_OFFICE_CODE'),
      school = Deno.env.get('NEIS_SCHOOL_CODE');
    if (!apiKey || !office || !school) return json({ error: 'SCHOOL_NOT_CONFIGURED' }, 503, origin);
    const cacheKey = kind + day;
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > Date.now()) return json({ items: hit.items }, 200, origin);
    const endpoint = kind === 'meals' ? 'mealServiceDietInfo' : 'SchoolSchedule';
    const url = new URL(`https://open.neis.go.kr/hub/${endpoint}`);
    url.search = new URLSearchParams({
      KEY: apiKey,
      Type: 'json',
      ATPT_OFCDC_SC_CODE: office,
      SD_SCHUL_CODE: school,
      pIndex: '1',
      pSize: '100',
      ...(kind === 'meals'
        ? { MLSV_YMD: day.replaceAll('-', '') }
        : { AA_YMD: day.replaceAll('-', '') }),
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('UPSTREAM');
    const data = await response.json();
    const code =
      data.RESULT?.CODE ||
      data[endpoint]?.[0]?.head?.find((x: Record<string, unknown>) => x.RESULT)?.RESULT?.CODE;
    if (!code || (code !== 'INFO-000' && code !== 'INFO-200')) throw new Error('UPSTREAM');
    const rows = data[endpoint]?.[1]?.row || [];
    const items = rows.map((r: Record<string, string>) =>
      kind === 'meals'
        ? {
            label: plain(r.MMEAL_SC_NM),
            title: '오늘의 메뉴',
            description: plain(r.DDISH_NM),
            calories: plain(r.CAL_INFO),
          }
        : { label: '학사일정', title: plain(r.EVENT_NM), description: plain(r.EVENT_CNTNT) },
    );
    if (cache.size > 100) cache.clear();
    cache.set(cacheKey, { expires: Date.now() + 3600000, items });
    return json({ items }, 200, origin);
  } catch {
    return json({ error: 'REQUEST_FAILED' }, 400, origin);
  }
});
