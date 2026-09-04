import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const message = params?.error === "locked"
    ? "ลองหลายครั้งเกินไป กรุณารอ 30 นาทีแล้วลองใหม่"
    : params?.error === "invalid"
      ? "รหัส PIN ไม่ถูกต้อง กรุณาตรวจแล้วลองใหม่"
      : null;

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">Bid Dashboard</p>
        <h1 id="login-title">ระบบค้นหางานประมูล ภาคอีสาน</h1>
        <p className="subtitle">กรอกรหัสเพื่อดูข้อมูลภายใน</p>
        {message ? <p className="login-error" role="alert">{message}</p> : null}
        <form action={loginAction} className="login-form">
          <input type="hidden" name="next" value={params?.next || "/"} />
          <label htmlFor="pin">รหัส PIN 6 หลัก</label>
          <input id="pin" name="pin" type="password" inputMode="numeric" autoComplete="current-password" pattern="[0-9]{6}" maxLength="6" required autoFocus />
          <p>ระบบจะจำอุปกรณ์นี้ไว้ 30 วัน</p>
          <button type="submit">เข้าสู่ระบบ</button>
        </form>
      </section>
    </main>
  );
}
