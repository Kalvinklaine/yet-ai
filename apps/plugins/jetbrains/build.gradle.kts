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
val copyGuiDist by tasks.registering(Copy::class) {
    onlyIf { guiDistDir.file("index.html").asFile.exists() }
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
        dependsOn(copyGuiDist)
    }

    matching { it.name == "buildSearchableOptions" }.configureEach {
        // Local dev-preview artifact builds must be deterministic and non-interactive;
        // searchable options can hang in headless local builds, so opt in explicitly.
        enabled = buildSearchableOptionsEnabled.get()
    }

    test {
        useJUnitPlatform()
    }

    patchPluginXml {
        pluginId = "ai.yet.plugin"
        pluginName = "Yet AI"
    }

    runIde {
        jvmArgs("-Xmx2048m")
    }
}
