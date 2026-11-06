import {
  BookOpen,
  Compass,
  CookingPot,
  Flag,
  FlaskConical,
  Handshake,
  Heart,
  Music2,
  PartyPopper,
  Plane,
  Shield,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import type { CategorySlug } from "@/domain/categories";

export const CATEGORY_ICONS: Record<CategorySlug, LucideIcon> = {
  travel: Plane,
  dating: Heart,
  race: Flag,
  "mind-games": Compass,
  survival: Shield,
  music: Music2,
  sports: Trophy,
  cooking: CookingPot,
  party: PartyPopper,
  knowledge: BookOpen,
  lab: FlaskConical,
  crew: Handshake,
};
