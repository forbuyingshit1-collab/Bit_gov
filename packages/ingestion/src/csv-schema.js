const FY2568_CONTRACT_HEADERS = [
  "จังหวัด",
  "สถานะโครงการ",
  "พิกัดของโครงการ",
  "ละติจูดโครงการ",
  "ลองจิจูดโครงการ",
];

export function repairCsvHeaders(headers, rowLength) {
  if (headers.length === rowLength) return headers;

  const provinceIndex = headers.indexOf("จังหวัด");
  const knownShiftedSchema =
    headers.length === 26
    && rowLength === 28
    && provinceIndex >= 0
    && FY2568_CONTRACT_HEADERS.every((header, offset) => headers[provinceIndex + offset] === header);

  if (!knownShiftedSchema) return headers;
  return [
    ...headers.slice(0, provinceIndex + 1),
    "อำเภอ",
    "ตำบล",
    ...headers.slice(provinceIndex + 1),
  ];
}
