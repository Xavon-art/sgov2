"use client";

import { motion } from "motion/react";
import { usePathname } from "next/navigation";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function CreateTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
