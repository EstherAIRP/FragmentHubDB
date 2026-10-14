import Link from "next/link";

import type { AuthSession } from "@/lib/auth";

export function AppNav({ session }: { session: AuthSession }) {
  return (
    <header className="appNav">
      <div className="appNavInner">
        <Link className="brand" href="/">
          <span className="brandMark">F</span>
          <span>
            <strong>FragmentHub</strong>
            <small>私人 Fragment 工作區</small>
          </span>
        </Link>

        <nav className="navLinks" aria-label="主要導覽">
          <Link href="/">看板</Link>
          <Link href="/fragments">Fragment</Link>
          <Link href="/fragments/new">新增</Link>
        </nav>

        <div className="accountMenu">
          {session.avatarUrl ? (
            <img
              className="accountAvatar"
              src={session.avatarUrl}
              alt=""
              width={30}
              height={30}
            />
          ) : (
            <span className="accountAvatarFallback">GH</span>
          )}
          <span className="accountLogin">@{session.login}</span>

          <form action="/api/auth/logout" method="post">
            <button className="textButton" type="submit">
              登出
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
