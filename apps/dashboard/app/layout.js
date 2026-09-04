import "./globals.css";

export const metadata = {
  title: "ระบบค้นหางานประมูล",
  description: "ระบบวิเคราะห์ข้อมูลจัดซื้อจัดจ้างภาครัฐ",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
