import { Router } from "express";
import { guessLimit, requireAuth } from "../auth/middleware.js";
import * as auth from "../controllers/auth.controller.js";

export const authRoutes = Router();

// Sign in / out
authRoutes.post("/login", guessLimit, auth.login);
authRoutes.post("/logout", auth.logout);

// Current user
authRoutes.get("/me", requireAuth, auth.getMe);
authRoutes.patch("/me", requireAuth, auth.updateMe);

// Passwords
authRoutes.post("/password", requireAuth, auth.changePassword);
authRoutes.post("/forgot-password", guessLimit, auth.forgotPassword);
authRoutes.get("/reset-password", guessLimit, auth.checkResetLink);
authRoutes.post("/reset-password", guessLimit, auth.resetPassword);

