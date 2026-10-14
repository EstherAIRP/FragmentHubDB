import Link from "next/link";

export default function NotFound() {
  return (
    <main className="loginShell">
      <section className="loginCard">
        <p className="eyebrow">404</p>
        <h1 className="loginTitle">找不到這筆 Fragment</h1>
        <p className="subtle">
          這個 ID 不存在，或目前 Repository 中尚未包含這筆資料。
        </p>
        <Link className="primaryButton linkButton" href="/fragments">
          回到 Fragment 庫
        </Link>
      </section>
    </main>
  );
}
