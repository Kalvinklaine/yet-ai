import org.gradle.api.GradleException
import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.Sync
import org.gradle.api.tasks.testing.Test
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant

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

val identityJson = groovy.json.JsonSlurper().parse(layout.projectDirectory.file("../../../product/identity.json").asFile) as Map<*, *>
val engineIdentity = identityJson["engine"] as Map<*, *>
val engineCrateName = engineIdentity["rustCrate"] as String
val engineBinaryBaseName = engineIdentity["binaryName"] as String
val engineBinaryFileName = if (System.getProperty("os.name").lowercase().contains("windows")) "$engineBinaryBaseName.exe" else engineBinaryBaseName
val engineProfile = providers.gradleProperty("yetAiEngineProfile").orElse("debug")
val engineBuildDirName = engineProfile.map { profile -> if (profile == "release") "release" else "debug" }
val expectedEngineBinary = layout.projectDirectory.file("../../../target/${engineBuildDirName.get()}/$engineBinaryFileName")
val packagedEngineResourcesDir = layout.buildDirectory.dir("generated/resources/yet-ai-engine")
val artifactMetadataResourcesDir = layout.buildDirectory.dir("generated/resources/yet-ai-artifact")
val stagedEngineBinary = packagedEngineResourcesDir.map { it.file("yet-ai-engine/$engineBinaryFileName") }
val artifactMetadataFile = artifactMetadataResourcesDir.map { it.file("yet-ai-artifact/build.properties") }

fun sha256(file: java.io.File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    Files.newInputStream(file.toPath()).use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

fun directorySha256(directory: java.io.File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    directory.walkTopDown()
        .filter { it.isFile }
        .sortedBy { it.relativeTo(directory).invariantSeparatorsPath }
        .forEach { file ->
            digest.update(file.relativeTo(directory).invariantSeparatorsPath.toByteArray())
            digest.update(0)
            digest.update(Files.readAllBytes(file.toPath()))
            digest.update(0)
        }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

fun gitCommit(): String {
    val output = providers.exec {
        commandLine("git", "rev-parse", "HEAD")
        workingDir(rootProject.layout.projectDirectory.asFile)
        isIgnoreExitValue = true
    }.standardOutput.asText.get().trim()
    return output.ifBlank { "unknown" }
}

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

val cargoBuildEngine by tasks.registering(Exec::class) {
    workingDir(rootProject.layout.projectDirectory.asFile)
    commandLine(listOf("cargo", "build", "-p", engineCrateName) + if (engineBuildDirName.get() == "release") listOf("--release") else emptyList())
    outputs.file(expectedEngineBinary)
    outputs.upToDateWhen { false }
}

val stageEngineResource by tasks.registering(Sync::class) {
    dependsOn(cargoBuildEngine)
    from(expectedEngineBinary)
    into(packagedEngineResourcesDir.map { it.dir("yet-ai-engine") })
    rename { engineBinaryFileName }
    filePermissions {
        unix("755")
    }
}

val writeArtifactMetadata by tasks.registering {
    dependsOn(stageEngineResource, copyGuiDist)
    inputs.file(expectedEngineBinary)
        .withPropertyName("expectedEngineBinary")
        .withPathSensitivity(PathSensitivity.NONE)
    outputs.file(artifactMetadataFile)
    doLast {
        val source = expectedEngineBinary.asFile
        val metadataFile = artifactMetadataFile.get().asFile
        metadataFile.parentFile.mkdirs()
        metadataFile.writeText(
            listOf(
                "build.commit=${gitCommit()}",
                "build.timestamp=${Instant.now()}",
                "gui.sha256=${directorySha256(guiDistDir.asFile)}",
                "engine.sha256=${sha256(source)}",
            ).joinToString("\n", postfix = "\n")
        )
    }
}

val verifyStagedEngineResource by tasks.registering {
    dependsOn(stageEngineResource, writeArtifactMetadata)
    inputs.file(expectedEngineBinary)
        .withPropertyName("expectedEngineBinary")
        .withPathSensitivity(PathSensitivity.NONE)
    inputs.file(stagedEngineBinary)
        .withPropertyName("stagedEngineBinary")
        .withPathSensitivity(PathSensitivity.NONE)
    doLast {
        val source = expectedEngineBinary.asFile
        val staged = stagedEngineBinary.get().asFile
        if (!source.isFile) {
            throw GradleException("Expected engine binary is missing: ${source.absolutePath}.")
        }
        if (!staged.isFile) {
            throw GradleException("Staged JetBrains engine resource is missing: ${staged.absolutePath}.")
        }
        if (source.length() <= 0L || staged.length() <= 0L) {
            throw GradleException("Engine binary and staged JetBrains resource must be non-empty.")
        }
        val sourceSha = sha256(source)
        val stagedSha = sha256(staged)
        if (sourceSha != stagedSha) {
            throw GradleException("Staged JetBrains engine resource SHA $stagedSha does not match current engine binary SHA $sourceSha. Re-run gradle buildPlugin after cargo build.")
        }
    }
}

tasks {
    processResources {
        dependsOn(copyGuiDist, verifyStagedEngineResource)
    }

    named("buildPlugin") {
        dependsOn(copyGuiDist, verifyStagedEngineResource)
    }

    named("prepareSandbox") {
        dependsOn(copyGuiDist, verifyStagedEngineResource)
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

    register("smokePackagedGuiServerBehavior") {
        group = "verification"
        description = "Verifies production packaged GUI panel behavior with current generated resources."
        dependsOn(test)
    }

    named<Test>("test") {
        if (gradle.startParameter.taskNames.any { it.substringAfterLast(':') == "smokePackagedGuiServerBehavior" }) {
            filter {
                includeTestsMatching("ai.yet.plugin.ui.PackagedGuiServerArtifactSmokeTest")
            }
        }
    }

    patchPluginXml {
        pluginId = "ai.yet.plugin"
        pluginName = "Yet AI"
    }

    runIde {
        jvmArgs("-Xmx2048m")
    }
}
