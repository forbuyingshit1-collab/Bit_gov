export const CKAN_ACTION_URL = "https://data.go.th/api/3/action";

export function fiscalYearDatasetTitle(fiscalYear) {
  return `ข้อมูลโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ ${fiscalYear}`;
}

export function sanitizeDataset(dataset) {
  const resources = (dataset?.resources ?? [])
    .filter(
      (resource) =>
        String(resource?.format ?? "").toUpperCase() === "CSV" &&
        resource?.datastore_active === true &&
        typeof resource?.id === "string" &&
        typeof resource?.url === "string",
    )
    .map((resource) => ({
      id: resource.id,
      name: typeof resource.name === "string" ? resource.name : null,
      format: "CSV",
      datastore_active: true,
      url: resource.url,
      last_modified: typeof resource.last_modified === "string" ? resource.last_modified : null,
      hash: typeof resource.hash === "string" ? resource.hash : null,
    }));

  return {
    id: typeof dataset?.id === "string" ? dataset.id : null,
    title: typeof dataset?.title === "string" ? dataset.title : null,
    metadata_modified:
      typeof dataset?.metadata_modified === "string" ? dataset.metadata_modified : null,
    resources,
  };
}
