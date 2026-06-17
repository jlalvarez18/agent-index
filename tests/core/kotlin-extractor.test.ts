import { describe, expect, test } from "vitest";
import { extractKotlin } from "../../src/core/extractors/kotlin.js";
import type { SourceFile } from "../../src/core/schema.js";

function sourceFile(text: string, relativePath = "app/src/main/java/com/acme/checkout/CheckoutViewModel.kt", role: SourceFile["role"] = "source"): SourceFile {
  return {
    absolutePath: `/repo/${relativePath}`,
    relativePath,
    language: "kotlin",
    role,
    text
  };
}

describe("extractKotlin", () => {
  test("extracts packages, imports, annotations, classes, interfaces, methods, extensions, coroutine calls, and Flow calls", () => {
    const result = extractKotlin(
      sourceFile(`package com.acme.checkout

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

interface PaymentRepository {
    fun observePayments(userId: UserId): Flow<PaymentState>
}

@HiltViewModel
class CheckoutViewModel @Inject constructor(
    private val repository: PaymentRepository
) : ViewModel(), PaymentRepository {
    override fun observePayments(userId: UserId): Flow<PaymentState> {
        return repository.observePayments(userId)
            .map { state -> state.withUiCopy() }
    }

    fun refresh(userId: UserId) {
        viewModelScope.launch {
            repository.observePayments(userId).collect { emitAnalytics(it) }
        }
    }
}

suspend fun Flow<PaymentState>.withReceiptRetry(
    retries: Int
): Flow<PaymentState> = retry(retries.toLong())
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "PaymentRepository",
          qualifiedName: "com.acme.checkout.PaymentRepository",
          kind: "class",
          parentSymbolName: "app/src/main/java/com/acme/checkout/CheckoutViewModel.kt"
        }),
        expect.objectContaining({
          name: "observePayments",
          qualifiedName: "com.acme.checkout.PaymentRepository.observePayments",
          kind: "method",
          parentSymbolName: "com.acme.checkout.PaymentRepository"
        }),
        expect.objectContaining({
          name: "CheckoutViewModel",
          qualifiedName: "com.acme.checkout.CheckoutViewModel",
          kind: "class",
          parentSymbolName: "app/src/main/java/com/acme/checkout/CheckoutViewModel.kt"
        }),
        expect.objectContaining({
          name: "refresh",
          qualifiedName: "com.acme.checkout.CheckoutViewModel.refresh",
          kind: "method",
          parentSymbolName: "com.acme.checkout.CheckoutViewModel"
        }),
        expect.objectContaining({
          name: "withReceiptRetry",
          qualifiedName: "com.acme.checkout.Flow.withReceiptRetry",
          kind: "function",
          parentSymbolName: "app/src/main/java/com/acme/checkout/CheckoutViewModel.kt"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "app/src/main/java/com/acme/checkout/CheckoutViewModel.kt",
          targetName: "com.acme.checkout",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "app/src/main/java/com/acme/checkout/CheckoutViewModel.kt",
          targetName: "androidx.lifecycle.ViewModel",
          kind: "symbol_imports_module",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutViewModel",
          targetName: "PaymentRepository",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutViewModel",
          targetName: "HiltViewModel",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutViewModel.observePayments",
          targetName: "map",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutViewModel.refresh",
          targetName: "launch",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutViewModel.refresh",
          targetName: "collect",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.Flow.withReceiptRetry",
          targetName: "Flow",
          kind: "symbol_calls_name",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.Flow.withReceiptRetry",
          targetName: "retry",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
    expect(result.chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbolName: "com.acme.checkout.CheckoutViewModel.refresh",
          text: expect.stringContaining("viewModelScope.launch")
        })
      ])
    );
  });

  test("extracts Gradle Kotlin DSL plugin, dependency, namespace, and included-module wiring", () => {
    const result = extractKotlin(
      sourceFile(
        `pluginManagement {
    repositories { google(); mavenCentral() }
}

include(":app", ":core:model")
`,
        "settings.gradle.kts"
      )
    );
    const buildResult = extractKotlin(
      sourceFile(
        `plugins {
    id("com.android.application")
    kotlin("android")
    alias(libs.plugins.kotlin.multiplatform)
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.acme.checkout"
}

kotlin {
    sourceSets {
        val commonMain by getting {
            dependencies {
                api(libs.kotlinx.coroutines.core)
            }
        }
        jvmTest.dependencies {
            implementation(libs.junit)
        }
    }
}

dependencies {
    implementation(project(":core:model"))
    testImplementation("junit:junit:4.13.2")
}
`,
        "app/build.gradle.kts"
      )
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: ":app,:core:model",
          qualifiedName: "gradle.include.app_core_model",
          kind: "method"
        })
      ])
    );
    expect(buildResult.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "com.android.application", qualifiedName: "gradle.plugin.com_android_application", kind: "method" }),
        expect.objectContaining({ name: "kotlin-android", qualifiedName: "gradle.plugin.kotlin_android", kind: "method" }),
        expect.objectContaining({ name: "libs.plugins.kotlin.multiplatform", qualifiedName: "gradle.plugin.libs_plugins_kotlin_multiplatform", kind: "method" }),
        expect.objectContaining({ name: "com.acme.checkout", qualifiedName: "gradle.namespace.com_acme_checkout", kind: "method" }),
        expect.objectContaining({ name: "commonMain", qualifiedName: "gradle.sourceSet.commonMain", kind: "method" }),
        expect.objectContaining({ name: "libs.kotlinx.coroutines.core", qualifiedName: "gradle.api.libs_kotlinx_coroutines_core", kind: "method" }),
        expect.objectContaining({ name: "jvmTest", qualifiedName: "gradle.sourceSet.jvmTest", kind: "method" }),
        expect.objectContaining({ name: "libs.junit", qualifiedName: "gradle.implementation.libs_junit", kind: "method" }),
        expect.objectContaining({ name: ":core:model", qualifiedName: "gradle.implementation.core_model", kind: "method" }),
        expect.objectContaining({ name: "junit:junit:4.13.2", qualifiedName: "gradle.testImplementation.junit_junit_4_13_2", kind: "method" })
      ])
    );
    expect(buildResult.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "gradle.implementation.core_model",
          targetName: ":core:model",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });

  test("extracts companion object DI factories and sealed object hierarchies", () => {
    const result = extractKotlin(
      sourceFile(`package com.acme.checkout

import dagger.Module
import dagger.Provides
import kotlinx.coroutines.flow.Flow

sealed interface PaymentEvent
data object PaymentStarted : PaymentEvent
data class PaymentFailed(val reason: String) : PaymentEvent

@Module
class CheckoutModule {
    companion object : Provider<PaymentRepository> {
        @Provides
        fun providePaymentRepository(api: PaymentApi): PaymentRepository {
            return RealPaymentRepository(api)
        }
    }
}
`)
    );

    expect(result.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "PaymentEvent", qualifiedName: "com.acme.checkout.PaymentEvent", kind: "class" }),
        expect.objectContaining({ name: "PaymentStarted", qualifiedName: "com.acme.checkout.PaymentStarted", kind: "class" }),
        expect.objectContaining({ name: "PaymentFailed", qualifiedName: "com.acme.checkout.PaymentFailed", kind: "class" }),
        expect.objectContaining({ name: "companion", qualifiedName: "com.acme.checkout.CheckoutModule.companion", kind: "class" }),
        expect.objectContaining({
          name: "providePaymentRepository",
          qualifiedName: "com.acme.checkout.CheckoutModule.companion.providePaymentRepository",
          kind: "method",
          parentSymbolName: "com.acme.checkout.CheckoutModule.companion"
        })
      ])
    );
    expect(result.edges).toEqual(
      expect.arrayContaining([
        {
          sourceSymbolName: "com.acme.checkout.PaymentStarted",
          targetName: "PaymentEvent",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.PaymentFailed",
          targetName: "PaymentEvent",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutModule.companion",
          targetName: "Provider",
          kind: "symbol_conforms_to",
          confidence: "name"
        },
        {
          sourceSymbolName: "com.acme.checkout.CheckoutModule.companion.providePaymentRepository",
          targetName: "Provides",
          kind: "symbol_calls_name",
          confidence: "name"
        }
      ])
    );
  });
});
