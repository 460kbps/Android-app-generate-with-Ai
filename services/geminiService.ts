import { GoogleGenAI, Type } from "@google/genai";
import type { AppPlan, FilePlan, Project, StructuredReview } from '../types';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const planSchema = {
  type: Type.OBJECT,
  properties: {
    appName: { type: Type.STRING, description: "A short, descriptive name for the app." },
    appDescription: { type: Type.STRING, description: "A one-sentence description of the app's purpose." },
    packageName: { type: Type.STRING, description: "A valid Java package name (e.g., com.example.appname)." },
    permissions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "An array of strings for required Android permissions."
    },
    dependencies: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "An array of strings for build.gradle dependencies."
    },
    fileStructure: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          path: { type: Type.STRING, description: "The full path of the file from the project root." },
          description: { type: Type.STRING, description: "A brief, one-sentence description of the file's purpose." },
        },
        required: ['path', 'description']
      },
      description: "An array of objects representing each file to be created."
    },
  },
  required: ['appName', 'appDescription', 'packageName', 'permissions', 'dependencies', 'fileStructure']
};

const suggestionSchema = {
    type: Type.OBJECT,
    properties: {
        id: { type: Type.STRING, description: "A short, unique kebab-case identifier for the suggestion (e.g., fix-null-pointer)." },
        description: { type: Type.STRING, description: "A clear, concise description of the suggested change." },
    },
    required: ['id', 'description']
};

const structuredReviewSchema = {
    type: Type.OBJECT,
    properties: {
        crashBugs: {
            type: Type.ARRAY,
            description: "A list of critical bugs that will likely cause the application to crash. Focus only on issues that would cause a runtime exception.",
            items: suggestionSchema
        },
        uiUxImprovements: {
            type: Type.ARRAY,
            description: "A list of suggestions to improve the user interface and user experience.",
            items: suggestionSchema
        },
        otherSuggestions: {
            type: Type.ARRAY,
            description: "A list of other general suggestions for code quality, best practices, etc.",
            items: suggestionSchema
        }
    },
    required: ['crashBugs', 'uiUxImprovements', 'otherSuggestions']
};


const analysisSchema = {
    type: Type.OBJECT,
    properties: {
        plan: planSchema,
        review: structuredReviewSchema
    },
    required: ['plan', 'review']
};

const reviewAndSummarySchema = {
    type: Type.OBJECT,
    properties: {
        review: structuredReviewSchema,
        changeSummary: { type: Type.STRING, description: "A concise summary of the changes made from the old code to the new code, in Markdown format." }
    },
    required: ['review', 'changeSummary']
};


export const generateAppPlan = async (prompt: string): Promise<AppPlan> => {
  const model = 'gemini-2.5-pro';
  const response = await ai.models.generateContent({
    model: model,
    contents: `You are an expert Android architect specializing in Java. Your task is to plan a complete, simple, and functional Android application based on the user's idea: "${prompt}".

The app must be self-contained and not require external APIs or complex libraries unless absolutely necessary for the core functionality. The goal is a project that a user can immediately import into Android Studio, build, and run.

Provide your response as a single JSON object. Ensure the file structure includes all necessary files for a basic, runnable Android project:
- build.gradle (Project level)
- app/build.gradle (App level)
- settings.gradle
- gradle.properties
- app/proguard-rules.pro
- app/src/main/AndroidManifest.xml
- All necessary Java source files (MainActivity, etc.).
- All necessary resource files (layouts, strings, colors, themes).`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: planSchema,
    }
  });

  const jsonResponse = JSON.parse(response.text);
  return jsonResponse as AppPlan;
};

export const generateFileCodeStream = async (plan: AppPlan, file: FilePlan) => {
  const model = 'gemini-2.5-flash';
  const planJson = JSON.stringify(plan, null, 2);

  return ai.models.generateContentStream({
    model: model,
    contents: `Based on the following Android app plan, generate the complete, production-quality code for the file located at "${file.path}".

**App Plan:**
\`\`\`json
${planJson}
\`\`\`

**Instructions:**
- Output ONLY the raw code for the file "${file.path}".
- Do not include any explanations, markdown formatting (like \`\`\`java), or any text other than the code itself.
- Ensure the code is syntactically correct and aligns with the overall app plan. For Java files, use the correct package name ("${plan.packageName}").
- For build.gradle files, include the specified dependencies.
- For AndroidManifest.xml, include the specified permissions.
`
  });
};

export const reviewCode = async (files: Record<string, string>): Promise<StructuredReview> => {
  const model = 'gemini-2.5-pro';
  let allFilesContent = '';
  for (const path in files) {
    allFilesContent += `\n\n---\nFile: ${path}\n---\n${files[path]}`;
  }

  const response = await ai.models.generateContent({
    model: model,
    contents: `You are a meticulous senior Android code reviewer. I have generated an entire Android application. Here is the complete file structure and content:
${allFilesContent}

**Task:**
Perform a thorough code review. Your feedback must be a single JSON object.
Categorize your suggestions into three lists:
1.  'crashBugs': Critical bugs that will likely cause a runtime crash (e.g., NullPointerExceptions, incorrect view casting).
2.  'uiUxImprovements': Suggestions to improve the user interface and experience (e.g., layout issues, unclear interactions).
3.  'otherSuggestions': General feedback on best practices, code readability, and maintainability.

Each suggestion in these lists must be an object with a unique 'id' (kebab-case string) and a concise 'description'.
Your response must be a single, valid JSON object that adheres to the schema.`,
    config: {
        responseMimeType: 'application/json',
        responseSchema: structuredReviewSchema,
    }
  });
  const jsonResponse = JSON.parse(response.text);
  return jsonResponse as StructuredReview;
};

export const analyzeChanges = async (oldFiles: Record<string, string>, newFiles: Record<string, string>): Promise<{ review: StructuredReview; changeSummary: string; }> => {
    const model = 'gemini-2.5-pro';
    
    let oldFilesContent = '';
    for (const path in oldFiles) {
        if (newFiles[path] && newFiles[path] !== oldFiles[path]) {
            oldFilesContent += `\n\n---\nFile: ${path} (BEFORE)\n---\n${oldFiles[path]}`;
        }
    }
     if (oldFilesContent === '') {
        oldFilesContent = "No files were changed. This was likely an addition of new files.";
    }

    let newFilesContent = '';
    for (const path in newFiles) {
        newFilesContent += `\n\n---\nFile: ${path} (AFTER)\n---\n${newFiles[path]}`;
    }

    const prompt = `You are a meticulous senior Android code reviewer. An AI assistant has just modified an Android application.

**Task:**
You are given the source code BEFORE and AFTER the changes. Generate a single JSON object with two properties:
1.  'changeSummary': A concise summary in Markdown format detailing the modifications made. Explain WHAT was changed and WHY.
2.  'review': A new, structured code review of the application in its CURRENT state (AFTER the changes). The review must be an object with three lists of suggestions: 'crashBugs', 'uiUxImprovements', and 'otherSuggestions'. Each suggestion must have a unique 'id' and a 'description'.

**Source Code (BEFORE changes - only modified files are shown):**
${oldFilesContent}

**Complete Source Code (AFTER changes):**
${newFilesContent}

Provide your response as a single, valid JSON object that adheres to the schema.`;

    const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: reviewAndSummarySchema,
        }
    });
    const jsonResponse = JSON.parse(response.text);
    return jsonResponse as { review: StructuredReview; changeSummary: string; };
};


export const modifyCodeStream = async (modificationPrompt: string, project: Project) => {
    const model = 'gemini-2.5-pro';
    let allFilesContent = '';
    for (const path in project.files) {
        allFilesContent += `\n\n---\nFile: ${path}\n---\n${project.files[path]}`;
    }

    return ai.models.generateContentStream({
        model,
        contents: `You are an expert Android developer specializing in Java. I have an existing Android application. I will provide you with all the current files and their content. The user wants to make a specific set of modifications.

**User's Requested Changes:**
${modificationPrompt}

**Current Application Plan:**
\`\`\`json
${JSON.stringify(project.plan, null, 2)}
\`\`\`

**Complete Current Source Code:**
${allFilesContent}

**Your Task:**
Implement the user's requested changes by providing the new, complete code for **only the files that need to be changed**.

**Output Format:**
You MUST stream your response using the following format. For each file you modify, output:
1. A single line with a file path delimiter: \`--FILE_START: [full/path/to/file]--\`
2. The complete, new source code for that file.
3. A single line with a file end delimiter: \`--FILE_END--\`

**Example:**
--FILE_START: app/src/main/java/com/example/app/MainActivity.java--
package com.example.app;
// ... new file content ...
public class MainActivity extends AppCompatActivity {
    // ...
}
--FILE_END--
--FILE_START: app/src/main/res/layout/activity_main.xml--
<LinearLayout ...>
    <!-- new layout content -->
</LinearLayout>
--FILE_END--

**Important:**
- Only include files that have changed.
- The code you provide for each file must be the *entire* file content, not just a diff or a snippet.
- Strictly adhere to the specified output format with the delimiters. Do not include any other text or explanations.`,
    });
};

export const analyzeImportedProject = async (files: Record<string, string>): Promise<{ plan: AppPlan, review: StructuredReview }> => {
    const model = 'gemini-2.5-pro';
    let allFilesContent = '';
    for (const path in files) {
        allFilesContent += `\n\n---\nFile: ${path}\n---\n${files[path]}`;
    }

    const prompt = `You are an expert Android architect. I'm providing you with the complete source code of an Android project. Your task is to analyze the entire project and generate the necessary metadata.

Here is the complete file structure and content of the application:
${allFilesContent}

**Your Task:**
Analyze the provided source code and generate a single JSON object containing:
1.  'plan': A complete application plan (appName, appDescription, packageName, permissions, dependencies, fileStructure).
2.  'review': A thorough, structured code review. The review must be an object with three lists of suggestions: 'crashBugs', 'uiUxImprovements', and 'otherSuggestions'. Each suggestion must have a unique 'id' and a 'description'.

**Output Format:**
Provide your response as a single, valid JSON object that adheres to the provided schema. Do not include any text or explanations outside of the JSON object.`;

    const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: analysisSchema,
        }
    });

    const jsonResponse = JSON.parse(response.text);
    return jsonResponse as { plan: AppPlan, review: StructuredReview };
};
