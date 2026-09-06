export const VIEWS = { search: 'ค้นหาโครงการ', company: 'ผลงานบริษัท', market: 'ภาพรวมตลาด', recommended: 'โครงการแนะนำ', forecast: 'คาดการณ์ความต้องการ', review: 'รายการรอตรวจ' };
export function readFilters(params) {
  const view = Object.hasOwn(VIEWS, params.view) ? params.view : 'search';
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  return { view, q: String(params.q ?? '').trim(), provinces: Object.hasOwn(params, 'submitted') || Object.hasOwn(params, 'province')
    ? list(params.province) : view === 'company' ? [] : ['อุดรธานี', 'ขอนแก่น'],
    fiscalYear: String(params.fiscalYear ?? ''), category: String(params.category ?? ''), subcategory: String(params.subcategory ?? ''),
    minPrice: String(params.minPrice ?? ''), maxPrice: String(params.maxPrice ?? ''),
    sort: params.sort === 'oldest' ? 'oldest' : 'newest', offset: Math.max(0, Math.floor(Number(params.offset) || 0)),
    scope: params.scope === 'all' ? 'all' : 'focus', company: ['iqoa','southeast'].includes(params.company) ? params.company : '' };
}
export function pageParams(filters) {
  const params = new URLSearchParams({ view: filters.view, submitted: '1' });
  for (const name of ['q', 'fiscalYear', 'category', 'subcategory', 'minPrice', 'maxPrice', 'sort', 'scope', 'company']) if (filters[name]) params.set(name, filters[name]);
  for (const province of filters.provinces) params.append('province', province);
  return params;
}
export function apiParams(filters) {
  const params = new URLSearchParams();
  for (const name of ['q', 'fiscalYear', 'category', 'subcategory', 'sort', 'scope', 'company', 'offset']) if (filters[name]) params.set(name, String(filters[name]));
  if (filters.provinces.length) params.set('provinces', filters.provinces.join(','));
  for (const name of ['minPrice', 'maxPrice']) if (filters[name] !== '') params.set(`${name}Sat`, String(Math.round(Number(filters[name]) * 100)));
  return params;
}
