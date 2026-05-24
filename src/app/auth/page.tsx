import { redirect } from "next/navigation";

// Legacy /auth — redirect to the new dedicated sign-in route.
export default function AuthIndex() {
  redirect("/auth/signin");
}
