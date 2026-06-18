import { describe, expect, test } from "vitest";
import { extractRuby } from "../../src/core/extractors/ruby.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "app/controllers/admin/users_controller.rb", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "ruby",
    role,
    text
  };
}

describe("extractRuby", () => {
  test("extracts modules, classes, methods, class methods, nesting, requires, hierarchy, mixins, and calls", () => {
    const result = extractRuby(
      sourceFile(`require "json"
require_relative "../../lib/audit_logger"
load "tasks/reporting.rake"

module Admin
  module Auditable
  end

  class UsersController < ApplicationController
    include Auditable
    extend Pagination
    prepend AroundAction

    def self.policy
      UserPolicy.new
    end

    def show
      render json: UserSerializer.new(current_user)
    end
  end
end
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "app/controllers/admin/users_controller.rb",
          qualifiedName: "app/controllers/admin/users_controller.rb",
          kind: "module"
        }),
        expect.objectContaining({
          name: "Admin",
          qualifiedName: "Admin",
          kind: "module",
          parentSymbolName: "app/controllers/admin/users_controller.rb"
        }),
        expect.objectContaining({
          name: "Auditable",
          qualifiedName: "Admin::Auditable",
          kind: "module",
          parentSymbolName: "Admin"
        }),
        expect.objectContaining({
          name: "UsersController",
          qualifiedName: "Admin::UsersController",
          kind: "class",
          parentSymbolName: "Admin"
        }),
        expect.objectContaining({
          name: "self.policy",
          qualifiedName: "Admin::UsersController.policy",
          kind: "method",
          parentSymbolName: "Admin::UsersController"
        }),
        expect.objectContaining({
          name: "show",
          qualifiedName: "Admin::UsersController.show",
          kind: "method",
          parentSymbolName: "Admin::UsersController"
        })
      ])
    );

    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "app/controllers/admin/users_controller.rb",
          targetName: "json",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "app/controllers/admin/users_controller.rb",
          targetName: "../../lib/audit_logger",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "app/controllers/admin/users_controller.rb",
          targetName: "Admin",
          kind: "file_contains_symbol",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Admin",
          targetName: "Admin::UsersController",
          kind: "symbol_contains_symbol",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Admin::UsersController",
          targetName: "ApplicationController",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController",
          targetName: "Auditable",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController",
          targetName: "Pagination",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController.policy",
          targetName: "UserPolicy",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController.show",
          targetName: "UserSerializer",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController.show",
          targetName: "current_user",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );

    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "Admin::UsersController.show",
          text: expect.stringContaining("UserSerializer.new(current_user)")
        })
      ])
    );
  });

  test("extracts compact namespace declarations and top-level Ruby DSL methods", () => {
    const result = extractRuby(
      sourceFile(
        `class Admin::ReportsController < Admin::BaseController
  before_action :authenticate_user!

  def index
    ReportQuery.call(params)
  end
end

namespace :reports do
  task refresh: :environment do
    Reports::RefreshJob.perform_now
  end
end
`,
        "lib/tasks/reports.rake"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ReportsController",
          qualifiedName: "Admin::ReportsController",
          kind: "class",
          parentSymbolName: "lib/tasks/reports.rake"
        }),
        expect.objectContaining({
          name: "index",
          qualifiedName: "Admin::ReportsController.index",
          kind: "method",
          parentSymbolName: "Admin::ReportsController"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "Admin::ReportsController",
          targetName: "Admin::BaseController",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::ReportsController.index",
          targetName: "ReportQuery",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::ReportsController.index",
          targetName: "call",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts RSpec describe, context, and example symbols", () => {
    const result = extractRuby(
      sourceFile(
        `RSpec.describe Admin::UsersController do
  context "GET #show" do
    it "renders the current user" do
      get :show
      expect(response).to have_http_status(:ok)
    end
  end
end
`,
        "spec/controllers/users_controller_spec.rb",
        "test"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Admin::UsersController",
          qualifiedName: "RSpec::Admin::UsersController",
          kind: "class",
          parentSymbolName: "spec/controllers/users_controller_spec.rb"
        }),
        expect.objectContaining({
          name: "GET_show",
          qualifiedName: "RSpec::Admin::UsersController.GET_show",
          kind: "method",
          parentSymbolName: "RSpec::Admin::UsersController"
        }),
        expect.objectContaining({
          name: "renders_the_current_user",
          qualifiedName: "RSpec::Admin::UsersController.GET_show.renders_the_current_user",
          kind: "method",
          parentSymbolName: "RSpec::Admin::UsersController.GET_show"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "RSpec::Admin::UsersController.GET_show.renders_the_current_user",
          targetName: "get",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "RSpec::Admin::UsersController.GET_show.renders_the_current_user",
          targetName: "have_http_status",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts Rake namespace and task symbols", () => {
    const result = extractRuby(
      sourceFile(
        `namespace :reports do
  desc "Refresh reporting cache"
  task refresh: :environment do
    Reports::RefreshJob.perform_now
  end
end
`,
        "lib/tasks/reports.rake"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "reports",
          qualifiedName: "rake.reports",
          kind: "module",
          parentSymbolName: "lib/tasks/reports.rake"
        }),
        expect.objectContaining({
          name: "refresh",
          qualifiedName: "rake.reports.refresh",
          kind: "method",
          parentSymbolName: "rake.reports"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "rake.reports.refresh",
          targetName: "Reports::RefreshJob",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "rake.reports.refresh",
          targetName: "perform_now",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts Rails routes, callbacks, and ActiveRecord declarations", () => {
    const routes = extractRuby(
      sourceFile(
        `Rails.application.routes.draw do
  namespace :admin do
    resources :users, only: [:index, :show]
    get "reports/:id", to: "reports#show"
    delete "users/:id", to: "users#destroy"
  end
end
`,
        "config/routes.rb"
      )
    );
    const model = extractRuby(
      sourceFile(
        `class User < ApplicationRecord
  has_many :posts
  validates :email, presence: true
  scope :active, -> { where(active: true) }
  before_save :normalize_email
end
`,
        "app/models/user.rb"
      )
    );

    expect(routes.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "admin", qualifiedName: "routes.admin", kind: "module" }),
        expect.objectContaining({ name: "users", qualifiedName: "routes.admin.users", kind: "method" }),
        expect.objectContaining({ name: "reports_id", qualifiedName: "routes.admin.reports_id", kind: "method" }),
        expect.objectContaining({ name: "users_id", qualifiedName: "routes.admin.users_id", kind: "method" })
      ])
    );
    expect(routes.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "routes.admin.reports_id",
          targetName: "ReportsController.show",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "routes.admin.users_id",
          targetName: "UsersController.destroy",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(model.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "has_many_posts", qualifiedName: "User.has_many_posts", kind: "method", parentSymbolName: "User" }),
        expect.objectContaining({ name: "validates_email", qualifiedName: "User.validates_email", kind: "method", parentSymbolName: "User" }),
        expect.objectContaining({ name: "scope_active", qualifiedName: "User.scope_active", kind: "method", parentSymbolName: "User" }),
        expect.objectContaining({ name: "before_save_normalize_email", qualifiedName: "User.before_save_normalize_email", kind: "method", parentSymbolName: "User" })
      ])
    );
  });

  test("extracts Rails migration table and index declarations", () => {
    const result = extractRuby(
      sourceFile(
        `class CreateUsers < ActiveRecord::Migration[7.1]
  def change
    create_table :users do |t|
      t.string :email, null: false
      t.timestamps
    end

    add_index :users, :email, unique: true
  end
end
`,
        "db/migrate/20260617000000_create_users.rb"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "create_table_users", qualifiedName: "CreateUsers.change.create_table_users", kind: "method" }),
        expect.objectContaining({ name: "add_index_users_email", qualifiedName: "CreateUsers.change.add_index_users_email", kind: "method" })
      ])
    );
  });

  test("extracts Cucumber feature and scenario symbols", () => {
    const result = extractRuby(
      sourceFile(
        `Feature: User sign in
  Scenario: Successful sign in
    Given a registered user
    When they sign in
    Then they see their dashboard

  Scenario Outline: Locked account
    Given a locked account
    Then sign in is denied
`,
        "features/sign_in.feature",
        "test"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "User_sign_in",
          qualifiedName: "feature.User_sign_in",
          kind: "class",
          parentSymbolName: "features/sign_in.feature"
        }),
        expect.objectContaining({
          name: "successful_sign_in",
          qualifiedName: "feature.User_sign_in.successful_sign_in",
          kind: "method",
          parentSymbolName: "feature.User_sign_in"
        }),
        expect.objectContaining({
          name: "locked_account",
          qualifiedName: "feature.User_sign_in.locked_account",
          kind: "method",
          parentSymbolName: "feature.User_sign_in"
        })
      ])
    );
  });

  test("does not emit Ruby keyword arguments and symbol literals as call-name edges", () => {
    const result = extractRuby(
      sourceFile(`class Admin::UsersController < ApplicationController
  def show
    render json: UserSerializer.new(current_user), status: :ok
  end
end
`)
    );

    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "Admin::UsersController.show",
          targetName: "render",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController.show",
          targetName: "UserSerializer",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "Admin::UsersController.show",
          targetName: "current_user",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(result.edges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceSymbolName: "Admin::UsersController.show", targetName: "json" }),
        expect.objectContaining({ sourceSymbolName: "Admin::UsersController.show", targetName: "status" }),
        expect.objectContaining({ sourceSymbolName: "Admin::UsersController.show", targetName: "ok" })
      ])
    );
  });

  test("resolves deterministic sibling instance and class method calls", () => {
    const result = extractRuby(
      sourceFile(`class Jobs::UserEmail < ApplicationJob
  def self.schedule(user_id)
    enqueue_delivery(user_id)
    self.instrument_delivery(user_id)
  end

  def self.enqueue_delivery(user_id)
    perform_later(user_id)
  end

  def self.instrument_delivery(user_id)
    Metrics.increment("user_email")
  end

  def execute(args)
    send_user_email(args)
  end

  def send_user_email(args)
    message_for_email(args[:user], args[:type])
  end

  def message_for_email(user, type)
    UserMailer.digest(user).deliver_later if type == "digest"
  end
end
`)
    );

    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "Jobs::UserEmail.execute",
          targetName: "Jobs::UserEmail.send_user_email",
          kind: "symbol_calls_name",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Jobs::UserEmail.send_user_email",
          targetName: "Jobs::UserEmail.message_for_email",
          kind: "symbol_calls_name",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Jobs::UserEmail.schedule",
          targetName: "Jobs::UserEmail.enqueue_delivery",
          kind: "symbol_calls_name",
          confidence: "exact"
        },
        {
          sourceSymbolName: "Jobs::UserEmail.schedule",
          targetName: "Jobs::UserEmail.instrument_delivery",
          kind: "symbol_calls_name",
          confidence: "exact"
        }
      ])
    );
  });

  test("extracts ActiveJob and Sidekiq worker declarations", () => {
    const activeJob = extractRuby(
      sourceFile(
        `class MailDeliveryJob < ApplicationJob
  queue_as :mailers
  retry_on Net::OpenTimeout
  discard_on ActiveJob::DeserializationError

  def perform(user_id)
    UserMailer.welcome(user_id).deliver_now
  end
end
`,
        "app/jobs/mail_delivery_job.rb"
      )
    );
    const sidekiqWorker = extractRuby(
      sourceFile(
        `class ReportRefreshWorker
  include Sidekiq::Worker
  sidekiq_options queue: :reports, retry: 3

  def perform(report_id)
    Reports::Refresh.call(report_id)
  end
end
`,
        "app/workers/report_refresh_worker.rb"
      )
    );

    expect(activeJob.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "queue_as_mailers", qualifiedName: "MailDeliveryJob.queue_as_mailers", kind: "method" }),
        expect.objectContaining({ name: "retry_on_Net_OpenTimeout", qualifiedName: "MailDeliveryJob.retry_on_Net_OpenTimeout", kind: "method" }),
        expect.objectContaining({
          name: "discard_on_ActiveJob_DeserializationError",
          qualifiedName: "MailDeliveryJob.discard_on_ActiveJob_DeserializationError",
          kind: "method"
        })
      ])
    );
    expect(sidekiqWorker.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "sidekiq_queue_reports", qualifiedName: "ReportRefreshWorker.sidekiq_queue_reports", kind: "method" }),
        expect.objectContaining({ name: "sidekiq_retry_3", qualifiedName: "ReportRefreshWorker.sidekiq_retry_3", kind: "method" })
      ])
    );
    expect(sidekiqWorker.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "ReportRefreshWorker",
          targetName: "Sidekiq::Worker",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "ReportRefreshWorker.perform",
          targetName: "Reports::Refresh",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });
});
