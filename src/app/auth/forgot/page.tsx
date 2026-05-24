import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { AuthForm } from "@/components/AuthForm";

export const metadata = {
  title: "Reset · DelOS",
  description: "Passwordless reset. DelOS sends a magic link to your email.",
};

export default function ForgotPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 glass-header">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link href="/"><Wordmark size={26} /></Link>
          <Link href="/auth/signin" className="btn-pixel ghost" style={{ padding: "6px 12px", fontSize: 11 }}>back to sign in →</Link>
        </div>
      </header>
      <main role="main" className="flex-1 flex items-center justify-center px-4 py-10">
        <AuthForm mode="forgot" />
      </main>
    </div>
  );
}
