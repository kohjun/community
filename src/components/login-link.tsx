"use client";
import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { loginHref } from "@/domain/login-return";

/** Shared guest actions retain the current page, including filters and fragment. */
export function LoginLink({
  returnTo,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { returnTo?: string }) {
  const [current, setCurrent] = useState("/");
  useEffect(() => {
    setCurrent(window.location.pathname + window.location.search + window.location.hash);
  }, []);
  return <Link {...props} href={loginHref(returnTo ?? current)} />;
}
