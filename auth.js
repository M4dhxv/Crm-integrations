import { supabase } from './supabase.js';

// ---- Session Guard ----
export async function requireAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/login.html';
        return null;
    }
    return session;
}

// ---- Get current user ----
export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

// ---- Sign in with email/password ----
export async function signInWithEmail(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });
    if (error) throw error;
    return data;
}

// ---- Sign up with email/password ----
export async function signUpWithEmail(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { full_name: fullName },
        },
    });
    if (error) throw error;
    return data;
}

// ---- OAuth sign in ----
export async function signInWithOAuth(provider) {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
            redirectTo: `${window.location.origin}/dashboard.html`,
        },
    });
    if (error) throw error;
    return data;
}

// ---- Password reset ----
export async function resetPassword(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login.html`,
    });
    if (error) throw error;
    return data;
}

// ---- Sign out ----
export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.href = '/login.html';
}

// ---- Auth state listener ----
export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}
