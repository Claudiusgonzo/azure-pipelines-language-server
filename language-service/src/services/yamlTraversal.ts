'use strict';

import * as Parser from "../parser/jsonParser";
import { YAMLDocument } from "../parser/yamlParser";
import { PromiseConstructor, Thenable } from "vscode-json-languageservice";
import { TextDocument, Position } from "vscode-languageserver-types";

export interface YamlNodeInfo {
    startPosition: Position;
    endPosition: Position;
    key: string;
    value: string;
}

export interface YamlNodePropertyValues {
    values: {[key: string]: string};
}

export interface YamlObjectNode {
    key: string;
    value: string;
    children: YamlObjectNode[];
    startPosition: Position;
    endPosition: Position;
    isArray?: boolean;
}

export class YAMLTraversal {

    private promise: PromiseConstructor;

    constructor(promiseConstructor: PromiseConstructor) {
        this.promise = promiseConstructor || Promise;
    }

    public getObjectTree(document: TextDocument, yamlDocument: YAMLDocument): Thenable<YamlObjectNode | undefined> {
        const jsonDocument = yamlDocument.documents.length > 0 ? yamlDocument.documents[0] : null;
        let nodeMap: {[key: number]: YamlObjectNode} = {};
        let root: YamlObjectNode = {
            key: "root",
            value: "root",
            children: [],
            startPosition: document.positionAt(jsonDocument.root.start),
            endPosition: document.positionAt(jsonDocument.root.end),
        };
        let currentId = 0;
        
        jsonDocument.visit(node => {
            if (node instanceof Parser.PropertyASTNode) {
                let primaryKey = (node as Parser.PropertyASTNode).key.value;
                if (primaryKey !== "stage" && primaryKey !== "task" && primaryKey !== "script" && primaryKey !== "job" && primaryKey !== "deployment") {
                    return true;
                }

                let parentObject = node.parent;
                while (parentObject && !nodeMap[(parentObject as any).tempId]) {
                    parentObject = parentObject.parent;
                }

                if (parentObject) {
                    if (nodeMap[(parentObject as any).tempId].key === "task") {
                        return true;
                    }
                }

                let parentObject2 = node.parent;
                while (parentObject2 && !(parentObject2 instanceof Parser.ObjectASTNode)) {
                    parentObject2 = parentObject2.parent;
                }

                let nodeForLength = parentObject2 && parentObject2 || node;
                let primaryValue = (node as Parser.PropertyASTNode).value.getValue();
                let nodeId = currentId++;
                (node as any).tempId = nodeId;
                let yamlNode = {
                    key: primaryKey,
                    value: primaryValue,
                    children: [],
                    startPosition: document.positionAt(nodeForLength.start),
                    endPosition: document.positionAt(nodeForLength.end),
                };
                nodeMap[nodeId] = yamlNode;

                if (parentObject) {
                    nodeMap[(parentObject as any).tempId].children.push(yamlNode);
                }
                else {
                    root.children.push(yamlNode);
                }
            }
            else if (node instanceof Parser.ArrayASTNode) {
                let location = (node as Parser.ArrayASTNode).location;
                if (location !== "stages" && location !== "steps" && location !== "jobs") {
                    return true;
                }

                let parentObject = node.parent;
                while (parentObject && !nodeMap[(parentObject as any).tempId]) {
                    parentObject = parentObject.parent;
                }

                let nodeId = currentId++;
                (node as any).tempId = nodeId;
                let yamlNode = {
                    key: location,
                    value: null,
                    children: [],
                    startPosition: document.positionAt(node.start),
                    endPosition: document.positionAt(node.end),
                    isArray: true
                };
                nodeMap[nodeId] = yamlNode;

                if (parentObject) {
                    nodeMap[(parentObject as any).tempId].children.push(yamlNode);
                }
                else {
                    root.children.push(yamlNode);
                }
            }

            return true;
        });

        this._flattenArrays(root);

        return this.promise.resolve(root);
    }

    private _flattenArrays = (node: YamlObjectNode) => {
        node.children.forEach(this._flattenArrays);

        let newChildren: YamlObjectNode[] = [];
        if (node.children.length === 1 && node.children[0].isArray) {
            newChildren = node.children[0].children;
        }
        else {
            for (let i = 0; i < node.children.length; ++ i) {
                if (node.children[i].isArray && i !== 0) {
                    node.children[i - 1].children = node.children[i - 1].children.concat(node.children[i].children);
                }
                else {
                    newChildren.push(node.children[i]);
                }
            }
        }

        node.children = newChildren;
    }

    public findNodes(document: TextDocument, yamlDocument: YAMLDocument, key: string): Thenable<YamlNodeInfo[]> {
        if(!document){
            this.promise.resolve([]);
        }

        const jsonDocument = yamlDocument.documents.length > 0 ? yamlDocument.documents[0] : null;
        if(jsonDocument === null){
            return this.promise.resolve([]);
        }

        let nodes: YamlNodeInfo[] = [];
        jsonDocument.visit((node => {
            const propertyNode = node as Parser.PropertyASTNode;
            if (propertyNode.key && propertyNode.key.value === key) {
                nodes.push({
                    startPosition: document.positionAt(node.parent.start),
                    endPosition: document.positionAt(node.parent.end),
                    key: propertyNode.key.value,
                    value: propertyNode.value.getValue()
                });
            }
            return true;
        }));

        return this.promise.resolve(nodes);
    }

    public getNodePropertyValues(document: TextDocument, yamlDocument: YAMLDocument, position: Position, propertyName: string): YamlNodePropertyValues {
        if(!document){
            return { values: null };
        }

        const offset: number = document.offsetAt(position);
        const jsonDocument = yamlDocument.documents.length > 0 ? yamlDocument.documents[0] : null;
        if(jsonDocument === null){
            return { values: null };
        }

        // get the node by position and then walk up until we find an object node with properties
        let node = jsonDocument.getNodeFromOffset(offset);
        while (node !== null && !(node instanceof Parser.ObjectASTNode)) {
            node = node.parent;
        }

        if (!node) {
            return { values: null };
        }

        // see if this object has an inputs property
        const propertiesArray = (node as Parser.ObjectASTNode).properties.filter(p => p.key.value === propertyName);
        if (!propertiesArray || propertiesArray.length !== 1) {
            return { values: null };
        }

        // get the values contained within inputs
        let valueMap: {[key: string]: string} = {};
        const parameterValueArray = (propertiesArray[0].value as Parser.ObjectASTNode).properties;
        parameterValueArray && parameterValueArray.forEach(p => {
            valueMap[p.key.value] = p.value.getValue();
        });

        return {
            values: valueMap
        };
    }
}

