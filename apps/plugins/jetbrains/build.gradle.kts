import org.gradle.api.GradleException
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.Sync

plugins {
    kotlin("jvm") version "2.2.21"
    id("org.jetbrains.intellij.platform") version "2.10.4"
}

group = "ai.yet"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

val guiDistDir = layout.projectDirectory.dir("../../gui/dist")
val packagedGuiResourcesDir = layout.buildDirectory.dir("generated/resources/yet-ai-gui")
val validateGuiDist by tasks.registering {
    doLast {
        if (!guiDistDir.file("index.html").asFile.isFile) {
            throw GradleException(
                "Missing apps/gui/dist/index.html. Run `npm --prefix apps/gui run build` before building the JetBrains plugin."
            )
        }
    }
}
val copyGuiDist by tasks.registering(Sync::class) {
    dependsOn(validateGuiDist)
    inputs.dir(guiDistDir)
        .withPropertyName("guiDist")
        .withPathSensitivity(PathSensitivity.RELATIVE)
    from(guiDistDir)
    into(packagedGuiResourcesDir.map { it.dir("yet-ai-gui") })
}

// Generated resource directory where `scripts/prepare-jetbrains-preview.mjs`
// stages the local cargo-built `yet-lsp` (or `yet-lsp.exe`) as a stable
// resource at `yet-ai-engine/yet-lsp` inside the plugin JAR. The directory is
// registered as a resources srcDir so a regular `gradle build` packages the
// staged binary if it is present, and simply produces an empty resource
// directory (no failure) if the prepare step has not run yet. This keeps dev
// builds green without relying on config-time file detection, which Gradle
// evaluates before the prepare script has had a chance to copy the binary.
val packagedEngineResourcesDir = layout.buildDirectory.dir("generated/resources/yet-ai-engine")
val artifactMetadataResourcesDir = layout.buildDirectory.dir("generated/resources/yet-ai-artifact")

val buildSearchableOptionsEnabled = providers.gradleProperty("yetAiBuildSearchableOptions")
    .map(String::toBoolean)
    .orElse(false)

dependencies {
    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")

    intellijPlatform {
        intellijIdeaCommunity("2024.3.7")
        bundledPlugin("com.intellij.java")
    }
}

kotlin {
    jvmToolchain(17)
}

sourceSets {
    main {
        resources.srcDir(packagedGuiResourcesDir)
        resources.srcDir(packagedEngineResourcesDir)
        resources.srcDir(artifactMetadataResourcesDir)
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "ai.yet.plugin"
        name = "Yet AI"
        version = project.version.toString()
        ideaVersion {
            sinceBuild = "243"
            untilBuild = provider { null }
        }
    }
}

tasks {
    processResources {
        mustRunAfter(copyGuiDist)
    }

    named("buildPlugin") {
        dependsOn(copyGuiDist)
    }

    named("prepareSandbox") {
        dependsOn(copyGuiDist)
    }

    matching { it.name == "buildSearchableOptions" }.configureEach {
        // Local/dev-preview artifact builds keep searchable options disabled by default
        // because this task can hang in headless environments. Release/full builds
        // must opt in explicitly with -PyetAiBuildSearchableOptions=true.
        enabled = buildSearchableOptionsEnabled.get()
    }

    test {
        useJUnitPlatform()
    }

    register<JavaExec>("printSmokeWrapperHtml") {
        group = "verification"
        description = "Prints production JetBrains wrapper HTML for browser smoke inputs."
        classpath = sourceSets["test"].runtimeClasspath
        mainClass.set("ai.yet.plugin.ui.SmokeRenderWrapperHtmlKt")
    }

    patchPluginXml {
        pluginId = "ai.yet.plugin"
        pluginName = "Yet AI"
    }

    runIde {
        jvmArgs("-Xmx2048m")
    }
}
