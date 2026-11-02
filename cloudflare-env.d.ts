declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    RESEND_API_KEY?: string;
    MAIL_FROM?: string;
    OWNER_PASSWORD_RESET?: string;
    ADMIN_SETUP_TOKEN?: string;
    ADMIN_INVITE_TOKEN?: string;
    ADMIN_INVITE_EXPIRES_AT?: string;
    ADMIN_GROUP_INVITE_TOKEN?: string;
    ADMIN_GROUP_INVITE_EXPIRES_AT?: string;
    BUCKET?: R2Bucket;
  }
}
