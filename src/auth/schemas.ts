import { z } from "zod";

export const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid work email, like name@company.com."));

/** For choosing a new password. Sign-in only checks that one was entered, so older passwords still work if the rules change. */
export const newPassword = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.");

export const loginBody = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
  remember: z.boolean().default(false),
});

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({ token: z.string().min(1), newPassword });

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword,
});

export const updateProfileBody = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100).optional(),
  title: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: email.optional(),
  // Required only when changing email
  currentPassword: z.string().optional(),
});
