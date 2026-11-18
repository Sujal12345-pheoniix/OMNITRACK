-- CreateEnum
CREATE TYPE "priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('todo', 'in_progress', 'in_review', 'rework', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "interaction_type" AS ENUM ('call', 'email', 'meeting', 'message', 'visit', 'note');

-- CreateEnum
CREATE TYPE "follow_up_type" AS ENUM ('call', 'email', 'meeting', 'visit', 'other');

-- CreateEnum
CREATE TYPE "follow_up_status" AS ENUM ('pending', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "daily_report_status" AS ENUM ('draft', 'submitted', 'acknowledged', 'clarification_requested');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "report_cutoff" TEXT NOT NULL DEFAULT '10:00',
ADD COLUMN     "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "task_status" NOT NULL DEFAULT 'todo',
    "priority" "priority" NOT NULL DEFAULT 'medium',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMPTZ(3),
    "assignee_employee_id" UUID,
    "reporter_employee_id" UUID NOT NULL,
    "reviewer_employee_id" UUID,
    "requires_review" BOOLEAN NOT NULL DEFAULT true,
    "lead_id" UUID,
    "customer_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "overdue_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_comments" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "author_employee_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'comment',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "scan_status" TEXT NOT NULL DEFAULT 'not_scanned',
    "uploaded_by_user_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "source" TEXT NOT NULL,
    "priority" "priority" NOT NULL DEFAULT 'medium',
    "status" "lead_status" NOT NULL DEFAULT 'new',
    "owner_employee_id" UUID,
    "estimated_value" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "expected_close_date" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "lost_reason" TEXT,
    "lost_note" TEXT,
    "status_before_lost" "lead_status",
    "customer_id" UUID,
    "contact_id" UUID,
    "won_at" TIMESTAMPTZ(3),
    "lost_at" TIMESTAMPTZ(3),
    "last_interaction_at" TIMESTAMPTZ(3),
    "next_follow_up_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_changes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_status" "lead_status",
    "to_status" "lead_status" NOT NULL,
    "owner_employee_id" UUID,
    "actor_user_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_stage_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "address" TEXT NOT NULL DEFAULT '',
    "status" "customer_status" NOT NULL DEFAULT 'active',
    "owner_employee_id" UUID,
    "created_from_lead_id" UUID,
    "last_interaction_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "customer_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "job_title" TEXT NOT NULL DEFAULT '',
    "owner_employee_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "interaction_type" NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER,
    "lead_id" UUID,
    "customer_id" UUID,
    "contact_id" UUID,
    "author_employee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "follow_up_type" NOT NULL DEFAULT 'call',
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "follow_up_status" NOT NULL DEFAULT 'pending',
    "assignee_employee_id" UUID NOT NULL,
    "lead_id" UUID,
    "customer_id" UUID,
    "contact_id" UUID,
    "outcome" TEXT NOT NULL DEFAULT '',
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "overdue_notified_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "verb" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "entity_label" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_employee_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "entity_type" TEXT,
    "entity_id" UUID,
    "dedupe_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "report_date" DATE NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "blockers" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "daily_report_status" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(3),
    "late" BOOLEAN NOT NULL DEFAULT false,
    "reviewer_employee_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_items" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "task_id" UUID,
    "interaction_id" UUID,
    "description" TEXT NOT NULL,
    "minutes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_report_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "picklist_values" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "list_key" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "picklist_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "won_value_target" BIGINT NOT NULL DEFAULT 0,
    "won_count_target" INTEGER NOT NULL DEFAULT 0,
    "set_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_organization_id_assignee_employee_id_status_idx" ON "tasks"("organization_id", "assignee_employee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_organization_id_reporter_employee_id_idx" ON "tasks"("organization_id", "reporter_employee_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_status_due_at_idx" ON "tasks"("organization_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "tasks_organization_id_lead_id_idx" ON "tasks"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "tasks_status_due_at_idx" ON "tasks"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_organization_id_code_key" ON "tasks"("organization_id", "code");

-- CreateIndex
CREATE INDEX "task_comments_organization_id_task_id_created_at_idx" ON "task_comments"("organization_id", "task_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storage_key_key" ON "documents"("storage_key");

-- CreateIndex
CREATE INDEX "documents_organization_id_entity_type_entity_id_idx" ON "documents"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "leads_organization_id_owner_employee_id_status_idx" ON "leads"("organization_id", "owner_employee_id", "status");

-- CreateIndex
CREATE INDEX "leads_organization_id_status_created_at_idx" ON "leads"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "leads_organization_id_email_idx" ON "leads"("organization_id", "email");

-- CreateIndex
CREATE INDEX "leads_organization_id_phone_normalized_idx" ON "leads"("organization_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "leads_organization_id_customer_id_idx" ON "leads"("organization_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_organization_id_code_key" ON "leads"("organization_id", "code");

-- CreateIndex
CREATE INDEX "lead_stage_changes_organization_id_lead_id_changed_at_idx" ON "lead_stage_changes"("organization_id", "lead_id", "changed_at");

-- CreateIndex
CREATE INDEX "lead_stage_changes_organization_id_to_status_changed_at_idx" ON "lead_stage_changes"("organization_id", "to_status", "changed_at");

-- CreateIndex
CREATE INDEX "customers_organization_id_normalized_name_idx" ON "customers"("organization_id", "normalized_name");

-- CreateIndex
CREATE INDEX "customers_organization_id_owner_employee_id_idx" ON "customers"("organization_id", "owner_employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_code_key" ON "customers"("organization_id", "code");

-- CreateIndex
CREATE INDEX "contacts_organization_id_customer_id_idx" ON "contacts"("organization_id", "customer_id");

-- CreateIndex
CREATE INDEX "contacts_organization_id_phone_normalized_idx" ON "contacts"("organization_id", "phone_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organization_id_email_key" ON "contacts"("organization_id", "email");

-- CreateIndex
CREATE INDEX "interactions_organization_id_lead_id_occurred_at_idx" ON "interactions"("organization_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_organization_id_customer_id_occurred_at_idx" ON "interactions"("organization_id", "customer_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_organization_id_author_employee_id_occurred_at_idx" ON "interactions"("organization_id", "author_employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "follow_ups_organization_id_assignee_employee_id_status_due__idx" ON "follow_ups"("organization_id", "assignee_employee_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "follow_ups_organization_id_lead_id_idx" ON "follow_ups"("organization_id", "lead_id");

-- CreateIndex
CREATE INDEX "follow_ups_status_due_at_idx" ON "follow_ups"("status", "due_at");

-- CreateIndex
CREATE INDEX "activity_events_organization_id_employee_id_occurred_at_idx" ON "activity_events"("organization_id", "employee_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "activity_events_organization_id_entity_type_entity_id_occur_idx" ON "activity_events"("organization_id", "entity_type", "entity_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_organization_id_verb_occurred_at_idx" ON "activity_events"("organization_id", "verb", "occurred_at");

-- CreateIndex
CREATE INDEX "notifications_organization_id_recipient_employee_id_read_at_idx" ON "notifications"("organization_id", "recipient_employee_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_organization_id_recipient_employee_id_dedupe__key" ON "notifications"("organization_id", "recipient_employee_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "daily_reports_organization_id_report_date_status_idx" ON "daily_reports"("organization_id", "report_date", "status");

-- CreateIndex
CREATE INDEX "daily_reports_organization_id_reviewer_employee_id_status_idx" ON "daily_reports"("organization_id", "reviewer_employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_organization_id_employee_id_report_date_key" ON "daily_reports"("organization_id", "employee_id", "report_date");

-- CreateIndex
CREATE INDEX "daily_report_items_organization_id_report_id_idx" ON "daily_report_items"("organization_id", "report_id");

-- CreateIndex
CREATE UNIQUE INDEX "picklist_values_organization_id_list_key_key_key" ON "picklist_values"("organization_id", "list_key", "key");

-- CreateIndex
CREATE UNIQUE INDEX "sales_targets_organization_id_employee_id_period_start_key" ON "sales_targets"("organization_id", "employee_id", "period_start");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reporter_employee_id_fkey" FOREIGN KEY ("reporter_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewer_employee_id_fkey" FOREIGN KEY ("reviewer_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_employee_id_fkey" FOREIGN KEY ("author_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_changes" ADD CONSTRAINT "lead_stage_changes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_employee_id_fkey" FOREIGN KEY ("owner_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_author_employee_id_fkey" FOREIGN KEY ("author_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_employee_id_fkey" FOREIGN KEY ("assignee_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_reviewer_employee_id_fkey" FOREIGN KEY ("reviewer_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_items" ADD CONSTRAINT "daily_report_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════
-- Hand-written security layer for release 1 operations and CRM tables.
-- ════════════════════════════════════════════════════════════════════════

-- Integrity rules Prisma cannot declare.
ALTER TABLE "tasks" ADD CONSTRAINT tasks_progress_range CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE "tasks" ADD CONSTRAINT tasks_single_link CHECK (num_nonnulls(lead_id, customer_id) <= 1);
ALTER TABLE "tasks" ADD CONSTRAINT tasks_done_has_completion CHECK ((status = 'done') = (completed_at IS NOT NULL));
ALTER TABLE "leads" ADD CONSTRAINT leads_contact_method CHECK (email IS NOT NULL OR phone IS NOT NULL);
ALTER TABLE "leads" ADD CONSTRAINT leads_email_lowercase CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "leads" ADD CONSTRAINT leads_value_non_negative CHECK (estimated_value >= 0);
ALTER TABLE "leads" ADD CONSTRAINT leads_lost_has_reason CHECK (status <> 'lost' OR lost_reason IS NOT NULL);
ALTER TABLE "leads" ADD CONSTRAINT leads_won_has_customer CHECK (status <> 'won' OR (customer_id IS NOT NULL AND won_at IS NOT NULL));
ALTER TABLE "contacts" ADD CONSTRAINT contacts_email_lowercase CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "customers" ADD CONSTRAINT customers_email_lowercase CHECK (email IS NULL OR email = lower(email));
ALTER TABLE "interactions" ADD CONSTRAINT interactions_has_target CHECK (num_nonnulls(lead_id, customer_id, contact_id) >= 1);
ALTER TABLE "interactions" ADD CONSTRAINT interactions_duration_range CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 0 AND 1440);
ALTER TABLE "follow_ups" ADD CONSTRAINT follow_ups_has_target CHECK (num_nonnulls(lead_id, customer_id, contact_id) >= 1);
ALTER TABLE "follow_ups" ADD CONSTRAINT follow_ups_completed_consistent CHECK ((status = 'completed') = (completed_at IS NOT NULL));
ALTER TABLE "daily_report_items" ADD CONSTRAINT daily_report_items_minutes CHECK (minutes IS NULL OR minutes BETWEEN 0 AND 1440);
ALTER TABLE "sales_targets" ADD CONSTRAINT sales_targets_month_start CHECK (extract(day FROM period_start) = 1);
ALTER TABLE "sales_targets" ADD CONSTRAINT sales_targets_non_negative CHECK (won_value_target >= 0 AND won_count_target >= 0);
ALTER TABLE "documents" ADD CONSTRAINT documents_size_limit CHECK (size_bytes BETWEEN 1 AND 26214400);
ALTER TABLE "organizations" ADD CONSTRAINT organizations_report_cutoff CHECK (report_cutoff ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "organizations" ADD CONSTRAINT organizations_working_days CHECK (working_days <@ ARRAY[1,2,3,4,5,6,7] AND cardinality(working_days) BETWEEN 1 AND 7);

-- Server-side search: trigram indexes for case-insensitive substring search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX leads_search_trgm ON "leads" USING gin ((contact_name || ' ' || company_name || ' ' || coalesce(email, '') || ' ' || code) gin_trgm_ops);
CREATE INDEX customers_search_trgm ON "customers" USING gin ((name || ' ' || code || ' ' || coalesce(email, '')) gin_trgm_ops);
CREATE INDEX contacts_search_trgm ON "contacts" USING gin ((first_name || ' ' || last_name || ' ' || coalesce(email, '')) gin_trgm_ops);
CREATE INDEX tasks_search_trgm ON "tasks" USING gin ((title || ' ' || code) gin_trgm_ops);
CREATE INDEX employees_search_trgm ON "employees" USING gin ((first_name || ' ' || last_name || ' ' || employee_code || ' ' || coalesce(work_email, '')) gin_trgm_ops);

-- Row-level security on every new tenant-owned table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks', 'task_comments', 'documents', 'leads', 'lead_stage_changes', 'customers', 'contacts',
    'interactions', 'follow_ups', 'activity_events', 'notifications', 'daily_reports',
    'daily_report_items', 'picklist_values', 'sales_targets'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org())',
      t);
  END LOOP;
END $$;

-- Application role.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "tasks", "task_comments", "documents", "leads", "customers", "contacts", "follow_ups",
  "notifications", "daily_reports", "daily_report_items", "picklist_values", "sales_targets"
TO omnitrack_app;
-- History tables are append-only for the application.
GRANT SELECT, INSERT ON "lead_stage_changes", "interactions", "activity_events" TO omnitrack_app;

-- Worker role: scheduled jobs run per organization under that organization's RLS context.
GRANT SELECT ON "organizations" TO omnitrack_worker;
GRANT SELECT, UPDATE (reminder_sent_at, overdue_notified_at) ON "follow_ups" TO omnitrack_worker;
GRANT SELECT, UPDATE (overdue_notified_at) ON "tasks" TO omnitrack_worker;
GRANT SELECT ON "leads", "customers", "contacts" TO omnitrack_worker;
GRANT SELECT, INSERT ON "notifications" TO omnitrack_worker;
