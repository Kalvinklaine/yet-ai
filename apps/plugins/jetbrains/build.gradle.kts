import org.gradle.api.GradleException
import org.gradle.api.artifacts.component.ProjectComponentIdentifier
import org.gradle.api.tasks.Exec
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.Sync
import org.gradle.api.tasks.testing.Test
import org.gradle.jvm.tasks.Jar
import org.gradle.jvm.toolchain.JavaLanguageVersion
import org.gradle.jvm.toolchain.JavaToolchainService
import java.nio.file.Files
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.ZipFile

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
val installableSmokeZipFile = providers.environmentVariable("YET_AI_INSTALLABLE_SMOKE_ZIP")
    .map { file(it).canonicalFile }

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
        filter {
            excludeTestsMatching("ai.yet.plugin.ui.PackagedGuiServerArtifactSmokeTest")
        }
        val artifactSmokeClass = "ai.yet.plugin.ui.PackagedGuiServerArtifactSmokeTest"
        val explicitlyRequested = gradle.startParameter.taskRequests
            .flatMap { it.args }
            .windowed(2)
            .any { (option, pattern) ->
                option == "--tests" && (pattern == artifactSmokeClass || pattern.startsWith("$artifactSmokeClass."))
        }
        if (explicitlyRequested) {
            throw GradleException("Use `gradle smokePackagedGuiServerBehavior` for PackagedGuiServerArtifactSmokeTest.")
        }
    }

    register<JavaExec>("printSmokeWrapperHtml") {
        group = "verification"
        description = "Prints production JetBrains wrapper HTML for browser smoke inputs."
        classpath = sourceSets["test"].runtimeClasspath
        mainClass.set("ai.yet.plugin.ui.SmokeRenderWrapperHtmlKt")
    }

    val composedJarArchive = named<Jar>("composedJar").flatMap { it.archiveFile }
    val artifactSmokeDirectory = layout.buildDirectory.dir("tmp/packaged-gui-server-artifact-smoke")
    val extractedPluginJar = artifactSmokeDirectory.map { it.file("nested-production.jar") }
    val artifactSmokeIdentity = artifactSmokeDirectory.map { it.file("identity.properties") }
    val preparePackagedGuiServerArtifactSmoke by registering {
        group = "verification"
        description = "Extracts and verifies the production plugin JAR used by the packaged GUI smoke."
        inputs.file(installableSmokeZipFile)
            .withPropertyName("installablePluginZip")
            .withPathSensitivity(PathSensitivity.NONE)
            .optional()
        outputs.file(extractedPluginJar)
        outputs.file(artifactSmokeIdentity)
        outputs.upToDateWhen { false }
        doLast {
            val installableZipFile = installableSmokeZipFile.orNull
                ?: throw GradleException("The dedicated artifact smoke requires YET_AI_INSTALLABLE_SMOKE_ZIP.")
            val rootDistDirectory = layout.projectDirectory.dir("../../../dist/plugins/jetbrains").asFile.canonicalFile
            if (!installableZipFile.isAbsolute || !installableZipFile.isFile || installableZipFile.parentFile != rootDistDirectory || !installableZipFile.name.endsWith("-dev-preview.zip")) {
                throw GradleException("The dedicated artifact smoke ZIP must be an existing root dev-preview ZIP under dist/plugins/jetbrains/.")
            }
            val composedJarFile = composedJarArchive.get().asFile.canonicalFile
            if (!composedJarFile.isFile) {
                throw GradleException("The prepared workspace composed JAR is missing. Run npm run prepare:jetbrains-preview before the dedicated artifact smoke.")
            }
            val extractedJarFile = extractedPluginJar.get().asFile
            extractedJarFile.parentFile.mkdirs()
            val nestedEntryName = ZipFile(installableZipFile).use { zip ->
                val entries = zip.entries().asSequence().toList()
                val unsafeEntries = entries.filter { entry ->
                    val name = entry.name
                    val path = name.removeSuffix("/")
                    name.isBlank() || name.contains('\\') || name.startsWith('/') || Regex("^[A-Za-z]:").containsMatchIn(name) ||
                        path.split('/').any { it.isBlank() || it == "." || it == ".." }
                }
                if (unsafeEntries.isNotEmpty()) {
                    throw GradleException("Installable plugin contains an unsafe ZIP entry path.")
                }
                val pluginJars = entries.filter {
                    !it.isDirectory &&
                        it.name.matches(Regex("[^/]+/lib/yet-ai-jetbrains-[^/]+\\.jar")) &&
                        !it.name.endsWith("-searchableOptions.jar")
                }
                if (pluginJars.size != 1) {
                    throw GradleException("Installable plugin must contain exactly one production plugin JAR; found ${pluginJars.size}.")
                }
                val nestedEntry = pluginJars.single()
                zip.getInputStream(nestedEntry).use { input ->
                    Files.newOutputStream(extractedJarFile.toPath()).use { output -> input.copyTo(output) }
                }
                nestedEntry.name
            }
            val composedSha = sha256(composedJarFile)
            val nestedSha = sha256(extractedJarFile)
            if (composedSha != nestedSha) {
                throw GradleException("Installable plugin production JAR does not match the prepared workspace composed JAR. Re-run npm run prepare:jetbrains-preview.")
            }
            val entryHashes = ZipFile(extractedJarFile).use { jar ->
                listOf(
                    "ai/yet/plugin/ui/PackagedGuiServer.class",
                    "yet-ai-gui/index.html",
                ).associateWith { entryName ->
                    val entry = jar.getEntry(entryName)
                        ?: throw GradleException("Extracted production plugin JAR is missing $entryName.")
                    jar.getInputStream(entry).use { input ->
                        MessageDigest.getInstance("SHA-256").digest(input.readBytes()).joinToString("") { "%02x".format(it) }
                    }
                }
            }
            artifactSmokeIdentity.get().asFile.writeText(
                listOf(
                    "nestedEntry=$nestedEntryName",
                    "jarSha256=$nestedSha",
                    "zipSha256=${sha256(installableZipFile)}",
                    "classSha256=${entryHashes.getValue("ai/yet/plugin/ui/PackagedGuiServer.class")}",
                    "indexSha256=${entryHashes.getValue("yet-ai-gui/index.html")}",
                ).joinToString("\n", postfix = "\n")
            )
        }
    }
    val externalTestRuntime = listOf("intellijPlatformTestClasspath", "intellijPlatformTestRuntimeClasspath")
        .map { configurationName ->
            configurations[configurationName].incoming.artifactView {
                componentFilter { it !is ProjectComponentIdentifier }
            }.files
        }
        .reduce { classpath, configuration -> classpath + configuration }
    val javaToolchains = project.extensions.getByType(JavaToolchainService::class.java)
    register<Test>("smokePackagedGuiServerBehavior") {
        group = "verification"
        description = "Verifies production packaged GUI panel behavior from the current installable artifact."
        dependsOn(preparePackagedGuiServerArtifactSmoke, "testClasses")
        testClassesDirs = sourceSets["test"].output.classesDirs
        useJUnitPlatform()
        filter {
            includeTestsMatching("ai.yet.plugin.ui.PackagedGuiServerArtifactSmokeTest")
        }
        inputs.file(extractedPluginJar)
            .withPropertyName("extractedPluginJar")
            .withPathSensitivity(PathSensitivity.NONE)
        inputs.file(artifactSmokeIdentity)
            .withPropertyName("artifactSmokeIdentity")
            .withPathSensitivity(PathSensitivity.NONE)
        outputs.upToDateWhen { false }
        javaLauncher.set(javaToolchains.launcherFor {
            languageVersion.set(JavaLanguageVersion.of(17))
        })

        var executedTests = 0L
        doFirst {
            executedTests = 0
            val productionJar = extractedPluginJar.get().asFile.canonicalFile
            val externalRuntime = externalTestRuntime.files.map { it.canonicalFile }
            val forbiddenRuntime = externalRuntime.filter { candidate ->
                candidate == productionJar || candidate.toPath().startsWith(layout.buildDirectory.get().asFile.canonicalFile.toPath())
            }
            if (forbiddenRuntime.isNotEmpty()) {
                throw GradleException("Packaged GUI artifact smoke runtime contains project-produced production output.")
            }
            classpath = files(productionJar) + sourceSets["test"].output + externalTestRuntime
            val identity = artifactSmokeIdentity.get().asFile.readLines().associate { line ->
                val separator = line.indexOf('=')
                if (separator <= 0) throw GradleException("Invalid packaged GUI artifact smoke identity metadata.")
                line.substring(0, separator) to line.substring(separator + 1)
            }
            systemProperty("yetAi.packagedSmokeRootZipSha256", identity.getValue("zipSha256"))
            systemProperty("yetAi.packagedSmokeJarSha256", identity.getValue("jarSha256"))
            systemProperty("yetAi.packagedSmokeClassSha256", identity.getValue("classSha256"))
            systemProperty("yetAi.packagedSmokeIndexSha256", identity.getValue("indexSha256"))
            systemProperty("yetAi.packagedSmokeJar", productionJar.absolutePath)
        }
        afterTest(KotlinClosure2({ _: org.gradle.api.tasks.testing.TestDescriptor, _: org.gradle.api.tasks.testing.TestResult ->
            executedTests += 1
        }))
        doLast {
            if (executedTests != 1L) {
                throw GradleException("Packaged GUI server behavior smoke must execute exactly one test; executed $executedTests.")
            }
            val identity = artifactSmokeIdentity.get().asFile.readLines().associate { line -> line.substringBefore('=') to line.substringAfter('=') }
            println("PACKAGED_GUI_SERVER_ARTIFACT_SMOKE_EXECUTED tests=1 jarSha256=${identity.getValue("jarSha256")} zipSha256=${identity.getValue("zipSha256")}")
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
