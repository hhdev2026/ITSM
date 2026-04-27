import { Suspense } from "react";
import { LoginClient } from "./login/LoginClient";

export default function HomePage() {
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
